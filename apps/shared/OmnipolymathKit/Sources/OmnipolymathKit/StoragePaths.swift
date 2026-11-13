import Foundation

public enum OmnipolymathNodeStorage {
    public static func appSupportDir() throws -> URL {
        let base = FileManager().urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        guard let base else {
            throw NSError(domain: "OmnipolymathNodeStorage", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Application Support directory unavailable",
            ])
        }
        return base.appendingPathComponent("Omnipolymath", isDirectory: true)
    }
}
