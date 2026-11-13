import Foundation

final class OutboxChangeHub: @unchecked Sendable {
    private let lock = NSLock()
    private var continuations: [UUID: AsyncStream<OmnipolymathChatOutboxChange>.Continuation] = [:]

    func stream() -> AsyncStream<OmnipolymathChatOutboxChange> {
        let id = UUID()
        let pair = AsyncStream<OmnipolymathChatOutboxChange>.makeStream()
        self.lock.withLock { self.continuations[id] = pair.continuation }
        pair.continuation.onTermination = { [weak self] _ in
            guard let self else { return }
            _ = self.lock.withLock { self.continuations.removeValue(forKey: id) }
        }
        return pair.stream
    }

    func yield(_ change: OmnipolymathChatOutboxChange) {
        let continuations = self.lock.withLock { Array(self.continuations.values) }
        for continuation in continuations {
            continuation.yield(change)
        }
    }

    func finish() {
        let continuations = self.lock.withLock {
            defer { self.continuations.removeAll() }
            return Array(self.continuations.values)
        }
        for continuation in continuations {
            continuation.finish()
        }
    }
}
