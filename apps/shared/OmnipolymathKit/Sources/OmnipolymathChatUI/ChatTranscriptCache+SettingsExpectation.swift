import Foundation

extension OmnipolymathChatSQLiteTranscriptCache {
    nonisolated static func encodeSessionSettingsExpectation(
        _ expectation: OmnipolymathChatSessionSettingsExpectation?) -> String?
    {
        guard let expectation,
              let data = try? JSONEncoder().encode(expectation)
        else { return nil }
        return String(bytes: data, encoding: .utf8)
    }

    nonisolated static func decodeSessionSettingsExpectation(
        _ raw: String?) throws -> OmnipolymathChatSessionSettingsExpectation?
    {
        guard let raw, !raw.isEmpty else { return nil }
        return try JSONDecoder().decode(
            OmnipolymathChatSessionSettingsExpectation.self,
            from: Data(raw.utf8))
    }
}
