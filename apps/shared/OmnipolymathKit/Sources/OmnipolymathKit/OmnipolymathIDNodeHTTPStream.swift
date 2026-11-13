import Foundation

/// Streaming resource transfer through the same W/connection as the native node socket.
/// No URLSession fallback and no body collection; callers await each bounded DATA write.
public actor OmnipolymathIDNodeHTTPStream {
    private let tunnel: OmnipolymathIDNodeTunnel
    private let reader: OmnipolymathIDNodeFrameReader
    private let stream: any OmnipolymathIDNodeStream
    private var head: Task<OmnipolymathIDNodeTunnelCodec.ResponseHead, Error>?
    private var writer: Task<Void, Error>?
    private var finishedBody = false
    private var canceled = false

    private init(tunnel: OmnipolymathIDNodeTunnel, stream: any OmnipolymathIDNodeStream) {
        self.tunnel = tunnel
        self.stream = stream
        self.reader = OmnipolymathIDNodeFrameReader(stream: stream)
    }

    public static func open(
        tunnel: OmnipolymathIDNodeTunnel, method: String, path: String, headers: [[String]] = []) async throws
        -> OmnipolymathIDNodeHTTPStream
    {
        let bytes = try OmnipolymathIDNodeTunnelCodec.requestHead(path: path, headers: headers, method: method)
        let stream = try await tunnel.openStream()
        do {
            try await omnipolymathIDNodeDeadline(.seconds(10), clock: .init()) { try await stream.write(bytes) }
            return OmnipolymathIDNodeHTTPStream(tunnel: tunnel, stream: stream)
        } catch {
            await stream.reset(code: 4)
            await stream.stop(code: 4)
            throw error
        }
    }

    public func writeBody(_ bytes: Data) async throws {
        guard !self.canceled, !self.finishedBody else { throw OmnipolymathIDNodeTransportError.closed }
        let frame = try OmnipolymathIDNodeTunnelCodec.frame(bytes, limit: OmnipolymathIDNodeTunnelProtocol.maximumHTTPDataBytes)
        let previous = self.writer
        let stream = self.stream
        let task = Task {
            if let previous { try await previous.value }
            try Task.checkCancellation()
            try await omnipolymathIDNodeDeadline(.seconds(120), clock: .init()) { try await stream.write(frame) }
        }
        self.writer = task
        do {
            try await withTaskCancellationHandler { try await task.value } onCancel: { task.cancel() }
        } catch {
            await self.cancel()
            throw error
        }
    }

    public func finishBody() async throws {
        guard !self.canceled, !self.finishedBody else { throw OmnipolymathIDNodeTransportError.closed }
        self.finishedBody = true
        do {
            if let writer = self.writer { try await writer.value }
            try Task.checkCancellation()
            try await self.stream.finish()
        } catch {
            await self.cancel()
            throw error
        }
    }

    public func responseHead() async throws -> OmnipolymathIDNodeTunnelCodec.ResponseHead {
        guard !self.canceled else { throw OmnipolymathIDNodeTransportError.closed }
        if let head = self.head { return try await self.waitForHead(head) }
        let reader = self.reader
        let tunnel = self.tunnel
        let task = Task {
            try await omnipolymathIDNodeDeadline(.seconds(120), clock: .init()) {
                guard let bytes = try await reader.next(limit: OmnipolymathIDNodeTunnelProtocol.maximumHeadBytes) else {
                    throw OmnipolymathIDNodeTransportError.truncatedFrame
                }
                let response = try OmnipolymathIDNodeTunnelCodec.responseHead(bytes)
                guard response.status != 101 else { throw OmnipolymathIDNodeTransportError.invalidHead }
                await tunnel.received()
                return response
            }
        }
        self.head = task
        return try await self.waitForHead(task)
    }

    private func waitForHead(
        _ task: Task<OmnipolymathIDNodeTunnelCodec.ResponseHead, Error>) async throws
        -> OmnipolymathIDNodeTunnelCodec.ResponseHead
    {
        do {
            return try await withTaskCancellationHandler {
                try Task.checkCancellation()
                return try await task.value
            } onCancel: {
                task.cancel()
                Task { await self.cancel() }
            }
        } catch {
            await self.cancel()
            throw error
        }
    }

    public func nextBody() async throws -> Data? {
        _ = try await self.responseHead()
        let reader = self.reader
        do {
            let bytes = try await omnipolymathIDNodeDeadline(.seconds(120), clock: .init()) {
                try await reader.next(limit: OmnipolymathIDNodeTunnelProtocol.maximumHTTPDataBytes)
            }
            if bytes != nil { await self.tunnel.received() }
            return bytes
        } catch {
            await self.cancel()
            throw error
        }
    }

    public func cancel() async {
        guard !self.canceled else { return }
        self.canceled = true
        self.head?.cancel()
        self.writer?.cancel()
        await self.stream.reset(code: 4)
        await self.stream.stop(code: 4)
    }
}
