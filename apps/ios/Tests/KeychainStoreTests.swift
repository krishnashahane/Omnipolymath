import Foundation
import OmnipolymathKit
import Testing
@testable import Omnipolymath

struct KeychainStoreTests {
    @Test func `save load update delete round trip`() {
        let service = "ai.omnipolymathfoundation.app.tests.\(UUID().uuidString)"
        let account = "value"

        #expect(GenericPasswordKeychainStore.delete(service: service, account: account))
        #expect(GenericPasswordKeychainStore.loadString(service: service, account: account) == nil)

        #expect(GenericPasswordKeychainStore.saveString("first", service: service, account: account))
        #expect(GenericPasswordKeychainStore.loadString(service: service, account: account) == "first")

        #expect(GenericPasswordKeychainStore.saveString("second", service: service, account: account))
        #expect(GenericPasswordKeychainStore.loadString(service: service, account: account) == "second")

        #expect(GenericPasswordKeychainStore.delete(service: service, account: account))
        #expect(GenericPasswordKeychainStore.loadString(service: service, account: account) == nil)
    }
}
