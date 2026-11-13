import Foundation
import Testing
@testable import Omnipolymath

struct NetworkStatusServiceTests {
    @Test func `reads an initial network path`() async throws {
        let payload = try await NetworkStatusService().currentStatus()

        #expect(!payload.interfaces.isEmpty)
    }
}
