import Foundation

public enum OmnipolymathNodeErrorCode: String, Codable, Sendable {
    case notPaired = "NOT_PAIRED"
    case unauthorized = "UNAUTHORIZED"
    case backgroundUnavailable = "NODE_BACKGROUND_UNAVAILABLE"
    case invalidRequest = "INVALID_REQUEST"
    case unavailable = "UNAVAILABLE"
    /// Rejected before a command handler or progress frame; safe for bounded admission recovery.
    case notReady = "NODE_NOT_READY"
    case systemRunDenied = "SYSTEM_RUN_DENIED"
    case permissionMissing = "PERMISSION_MISSING"
}

public enum OmnipolymathPermissionState: String, Codable, Sendable {
    case notDetermined = "not-determined"
    case denied
    case restartRequired = "restart-required"
    case staleGrant = "stale-grant"
    case disabledInOmnipolymath = "disabled-in-omnipolymath"
}

public struct OmnipolymathPermissionDetails: Codable, Sendable, Equatable {
    public var capabilities: [String]
    public var state: OmnipolymathPermissionState

    public init(capabilities: [String], state: OmnipolymathPermissionState) {
        self.capabilities = capabilities
        self.state = state
    }
}

public struct OmnipolymathNodeError: Error, Codable, Sendable, Equatable {
    public var code: OmnipolymathNodeErrorCode
    public var message: String
    public var retryable: Bool?
    public var retryAfterMs: Int?
    public var details: OmnipolymathPermissionDetails?

    public init(
        code: OmnipolymathNodeErrorCode,
        message: String,
        retryable: Bool? = nil,
        retryAfterMs: Int? = nil,
        details: OmnipolymathPermissionDetails? = nil)
    {
        self.code = code
        self.message = message
        self.retryable = retryable
        self.retryAfterMs = retryAfterMs
        self.details = details
    }
}
