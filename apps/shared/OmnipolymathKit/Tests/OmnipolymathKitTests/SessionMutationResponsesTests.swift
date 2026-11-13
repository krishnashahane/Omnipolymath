import Foundation
import Testing
@testable import OmnipolymathKit

struct SessionMutationResponsesTests {
    @Test
    func `compact response accepts success`() throws {
        try OmnipolymathSessionsCompactResponse.requireSuccess(
            from: Data(#"{"ok":true,"key":"agent:main:main","compacted":true}"#.utf8))
    }

    @Test
    func `compact response surfaces gateway failure reason`() {
        let data = Data(
            #"{"ok":false,"key":"agent:main:main","compacted":false,"reason":"turn failed"}"#.utf8)
        do {
            try OmnipolymathSessionsCompactResponse.requireSuccess(
                from: data)
            Issue.record("expected failed compaction response to throw")
        } catch let error as OmnipolymathSessionsCompactError {
            #expect(error.errorDescription == "turn failed")
        } catch {
            Issue.record("unexpected error: \(error)")
        }
    }
}
