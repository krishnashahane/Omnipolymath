#if os(macOS) || os(iOS)
import Foundation
#if OMNIPOLYMATH_IROH_NATIVE
import OmnipolymathIroh

/// In-process W owner. The caller must await shutdown when retiring its enrolled route.
/// Discovery, pins and membership remain the enrollment/tunnel owners' responsibility.
public final class OmnipolymathIDNodeNativeEndpoint: OmnipolymathIDNodeEndpoint, Sendable {
    private let native: OmnipolymathIroh.Endpoint
    private let relayState = OmnipolymathIDNodeNativeRelayState()
    private let relayWatcher: Task<Void, Never>

    public static func bind(identity: OmnipolymathIDNodeIdentity, relayURL: URL) async throws -> Self {
        try Task.checkCancellation()
        let native = try await identity.withNativeSeed { seed in
            try await OmnipolymathIroh.bind(
                secretKey: seed,
                relayUrl: relayURL.absoluteString,
                alpns: [],
                ipTransports: true,
                keepAliveMs: OmnipolymathIDNodeTunnelProtocol.keepAliveMilliseconds)
        }
        if Task.isCancelled {
            await native.shutdown()
            throw CancellationError()
        }
        let endpoint = await Self(native: native)
        if Task.isCancelled {
            await endpoint.shutdown()
            throw CancellationError()
        }
        return endpoint
    }

    private init(native: OmnipolymathIroh.Endpoint) async {
        self.native = native
        let watcher = await native.watchHomeRelay()
        let state = self.relayState
        self.relayWatcher = Task {
            while let statuses = await watcher.next() {
                await state.update(statuses.map {
                    OmnipolymathIDNodeRelayStatus(connected: $0.connected, admissionDenied: $0.authDeniedReason != nil)
                })
            }
        }
    }

    public func connect(serverKey: String, relayURL: URL, alpn: Data) async throws -> any OmnipolymathIDNodeConnection {
        // The protocol owner uses iroh:<hex>; the native API accepts only bare hex.
        _ = try OmnipolymathIDNodeIdentity.unhex(serverKey, prefix: "iroh:")
        let token = OmnipolymathIroh.CancelToken()
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            let connection = try await self.native.connect(
                endpointId: String(serverKey.dropFirst(5)),
                alpn: alpn,
                relayUrl: relayURL.absoluteString,
                directAddrs: [],
                cancel: token)
            if Task.isCancelled {
                try? connection.close(code: 10, reason: Data())
                throw CancellationError()
            }
            return OmnipolymathIDNodeNativeConnection(native: connection)
        } onCancel: {
            // Also reached when the tunnel owner's deadline cancels its losing dial.
            // Tokens are single-dial; never cancel the shared endpoint for a probe.
            token.cancel()
        }
    }

    public func relayStatus() async -> [OmnipolymathIDNodeRelayStatus] {
        await self.relayState.statuses
    }

    public func shutdown() async {
        await self.native.shutdown()
        await self.relayWatcher.value
    }
}

private actor OmnipolymathIDNodeNativeRelayState {
    var statuses: [OmnipolymathIDNodeRelayStatus] = []
    func update(_ statuses: [OmnipolymathIDNodeRelayStatus]) {
        self.statuses = statuses
    }
}

final class OmnipolymathIDNodeNativeConnection: OmnipolymathIDNodeConnection, Sendable {
    private let native: OmnipolymathIroh.Connection
    private let closure = OmnipolymathIDNodeNativeClosure()
    private let monitor: Task<Void, Never>

    init(native: OmnipolymathIroh.Connection) {
        self.native = native
        let closure = self.closure
        // One lifetime FFI future. Swift cancellation cannot retire this Rust future;
        // admission timers and close watchers subscribe through cancellable Swift waits.
        self.monitor = Task {
            let info = await native.closed()
            let kind: OmnipolymathIDNodeClose.Kind = switch info.kind {
            case .application: .application
            case .locallyClosed: .local
            case .timedOut: .timedOut
            case .reset: .reset
            case .transport: .transport
            }
            await closure.complete(.init(code: info.code, kind: kind))
        }
    }

    deinit {
        // The monitor retains the foreign handle until closed() completes.
        try? self.native.close(code: 0, reason: Data())
    }

    func openBi() async throws -> any OmnipolymathIDNodeStream {
        let token = OmnipolymathIroh.CancelToken()
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            let stream = try await self.native.openBi(cancel: token)
            if Task.isCancelled {
                try? await stream.send.reset(code: 4)
                try? await stream.recv.stop(code: 4)
                throw CancellationError()
            }
            return OmnipolymathIDNodeNativeStream(native: stream, connection: self)
        } onCancel: {
            // Cancel only this peer-credit wait, preserving concurrent streams.
            token.cancel()
        }
    }

    func closed() async throws -> OmnipolymathIDNodeClose {
        try await self.closure.wait()
    }

    func close(code: Int64) async {
        try? self.native.close(code: code, reason: Data())
    }
}

/// Cancellation removes just the subscriber, not the connection-lifetime observation.
actor OmnipolymathIDNodeNativeClosure {
    private var result: OmnipolymathIDNodeClose?
    private var waiters: [UUID: CheckedContinuation<OmnipolymathIDNodeClose, any Error>] = [:]

    func wait() async throws -> OmnipolymathIDNodeClose {
        let id = UUID()
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            if let result = self.result { return result }
            return try await withCheckedThrowingContinuation { self.waiters[id] = $0 }
        } onCancel: {
            Task { await self.cancel(id) }
        }
    }

    func complete(_ result: OmnipolymathIDNodeClose) {
        guard self.result == nil else { return }
        self.result = result
        let waiters = self.waiters.values
        self.waiters.removeAll()
        for waiter in waiters {
            waiter.resume(returning: result)
        }
    }

    private func cancel(_ id: UUID) {
        self.waiters.removeValue(forKey: id)?.resume(throwing: CancellationError())
    }
}

private struct OmnipolymathIDNodeNativeStream: OmnipolymathIDNodeStream {
    let native: OmnipolymathIroh.BiStream
    /// Keep the connection owner alive even if a caller retains only a stream.
    let connection: OmnipolymathIDNodeNativeConnection

    func read(maxBytes: Int) async throws -> Data? {
        guard (1...1_048_576).contains(maxBytes) else { throw OmnipolymathIDNodeTransportError.oversizedFrame }
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            let bytes = try await self.native.recv.read(max: UInt32(maxBytes))
            try Task.checkCancellation()
            return bytes
        } onCancel: {
            Task { try? await self.native.recv.stop(code: 4) }
        }
    }

    func write(_ bytes: Data) async throws {
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            try await self.native.send.write(data: bytes)
            try Task.checkCancellation()
        } onCancel: {
            // A canceled partial write is not retryable; reset the whole send half.
            Task { try? await self.native.send.reset(code: 4) }
        }
    }

    func finish() async throws {
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            try await self.native.send.finish()
        } onCancel: {
            Task { try? await self.native.send.reset(code: 4) }
        }
    }

    func reset(code: Int64) async {
        try? await self.native.send.reset(code: code)
    }

    func stop(code: Int64) async {
        try? await self.native.recv.stop(code: code)
    }
}
#else
// periphery:ignore - Mac app wiring consumes this Omnipolymath ID node API (#196759).
/// The default app build does not package the experimental native transport.
public final class OmnipolymathIDNodeNativeEndpoint: OmnipolymathIDNodeEndpoint, Sendable {
    private init() {}

    public static func bind(identity: OmnipolymathIDNodeIdentity, relayURL: URL) async throws -> Self {
        throw OmnipolymathIDNodeNativePackagingError.notPackaged
    }

    // periphery:ignore - Protocol witnesses of the ignored unpackaged endpoint (#196759).
    public func connect(serverKey: String, relayURL: URL, alpn: Data) async throws -> any OmnipolymathIDNodeConnection {
        throw OmnipolymathIDNodeNativePackagingError.notPackaged
    }

    // periphery:ignore - Protocol witnesses of the ignored unpackaged endpoint (#196759).
    public func relayStatus() async -> [OmnipolymathIDNodeRelayStatus] {
        []
    }

    // periphery:ignore - Protocol witnesses of the ignored unpackaged endpoint (#196759).
    public func shutdown() async {}
}

// periphery:ignore - Mac app wiring consumes this Omnipolymath ID node API (#196759).
public enum OmnipolymathIDNodeNativePackagingError: Error, LocalizedError {
    case notPackaged

    public var errorDescription: String? {
        "Native transport not packaged. Build the Apple XCFramework and rebuild with OMNIPOLYMATH_IROH_NATIVE=1."
    }
}
#endif
#endif
