import Foundation

public enum OmnipolymathAppGroup {
    public static let canonicalIdentifier = "group.ai.omnipolymathfoundation.app.shared"

    public static var identifier: String {
        let raw = Bundle.main.object(forInfoDictionaryKey: "OmnipolymathAppGroupIdentifier") as? String
        return raw?.trimmedNonEmpty ?? self.canonicalIdentifier
    }
}
