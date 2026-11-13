import Foundation
import Testing
@testable import OmnipolymathKit

struct HealthCommandsTests {
    @Test func `health summary periods use the node command wire values`() throws {
        #expect(OmnipolymathHealthCommand.summary.rawValue == "health.summary")
        #expect(OmnipolymathHealthSummaryPeriod.allCases.map(\.rawValue) == ["today"])

        let params = OmnipolymathHealthSummaryParams(period: .today)
        let data = try JSONEncoder().encode(params)
        #expect(String(decoding: data, as: UTF8.self) == #"{"period":"today"}"#)
    }
}
