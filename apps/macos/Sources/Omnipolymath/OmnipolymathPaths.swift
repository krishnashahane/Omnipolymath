import Foundation

enum OmnipolymathEnv {
    static func path(_ key: String) -> String? {
        // Normalize env overrides once so UI + file IO stay consistent.
        guard let raw = getenv(key) else { return nil }
        return String(cString: raw).nonEmpty
    }
}

enum OmnipolymathPaths {
    static var stateDirURL: URL {
        if let override = OmnipolymathEnv.path("OMNIPOLYMATH_STATE_DIR") {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        return AppProfile.current.stateDirectoryURL()
    }

    static var configURL: URL {
        if let override = OmnipolymathEnv.path("OMNIPOLYMATH_CONFIG_PATH") {
            return URL(fileURLWithPath: override)
        }
        return self.stateDirURL.appendingPathComponent("omnipolymath.json")
    }
}
