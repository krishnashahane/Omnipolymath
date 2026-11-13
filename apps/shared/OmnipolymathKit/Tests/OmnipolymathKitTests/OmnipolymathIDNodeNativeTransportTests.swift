#if os(macOS) || os(iOS)
import Foundation
import Testing
@testable import OmnipolymathKit

#if OMNIPOLYMATH_IROH_NATIVE
import OmnipolymathIroh

struct OmnipolymathIDNodeNativeTransportTests {
    @Test func `canceled admission wait does not cancel lifetime observation`() async throws {
        let native = NativeCloseTestConnection(noHandle: .init())
        let connection = OmnipolymathIDNodeNativeConnection(native: native)
        // Like the tunnel's admission race, but no wall clock or real sleeps.
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask { _ = try await connection.closed() }
            group.addTask {}
            _ = try await group.next()
            group.cancelAll()
        }
        let code: Int64 = (1 << 61) + 9
        await native.state.complete(.init(kind: .application, code: code, reason: "display only"))
        let close = try await connection.closed()
        #expect(close == .init(code: code, kind: .application))
        #expect(await native.state.calls == 1)
        #expect(try await connection.closed() == close)
    }
}

/// Models UniFFI's uncancellable Rust future; only a real close completes it.
private final class NativeCloseTestConnection: OmnipolymathIroh.Connection, @unchecked Sendable {
    let state = NativeCloseTestState()
    override func closed() async -> OmnipolymathIroh.CloseInfo {
        await self.state.wait()
    }

    override func close(code: Int64, reason: Data) throws {
        Task { await self.state.complete(.init(kind: .locallyClosed, code: nil, reason: "")) }
    }
}

private actor NativeCloseTestState {
    private var result: OmnipolymathIroh.CloseInfo?
    private var pending: [CheckedContinuation<OmnipolymathIroh.CloseInfo, Never>] = []
    var calls = 0

    func wait() async -> OmnipolymathIroh.CloseInfo {
        self.calls += 1
        if let result { return result }
        return await withCheckedContinuation { self.pending.append($0) }
    }

    func complete(_ result: OmnipolymathIroh.CloseInfo) {
        guard self.result == nil else { return }
        self.result = result
        let pending = self.pending
        self.pending.removeAll()
        for waiter in pending {
            waiter.resume(returning: result)
        }
    }
}
#else
struct OmnipolymathIDNodeNativeTransportTests {
    @Test func `unpackaged transport fails before native access`() async throws {
        let identity = try OmnipolymathIDNodeIdentity(seed: Data(repeating: 7, count: 32))
        let relay = try #require(URL(string: "https://relay.invalid"))
        await #expect(throws: OmnipolymathIDNodeNativePackagingError.notPackaged) {
            _ = try await OmnipolymathIDNodeNativeEndpoint.bind(identity: identity, relayURL: relay)
        }
    }
}
#endif
#endif
