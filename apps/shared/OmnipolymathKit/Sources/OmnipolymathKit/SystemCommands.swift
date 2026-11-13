import Foundation

public enum OmnipolymathSystemCommand: String, Codable, Sendable {
    case run = "system.run"
    case which = "system.which"
    case notify = "system.notify"
    case execApprovalsGet = "system.execApprovals.get"
    case execApprovalsSet = "system.execApprovals.set"
}

public enum OmnipolymathFileSystemCommand: String, Codable, Sendable {
    case listDir = "fs.listDir"
}

public enum OmnipolymathNotificationPriority: String, Codable, Sendable {
    case passive
    case active
    case timeSensitive
}

public enum OmnipolymathNotificationDelivery: String, Codable, Sendable {
    case system
    case overlay
    case auto
}

public struct OmnipolymathSystemNotifyParams: Codable, Sendable, Equatable {
    public var title: String
    public var body: String
    public var sound: String?
    public var priority: OmnipolymathNotificationPriority?
    public var delivery: OmnipolymathNotificationDelivery?

    public init(
        title: String,
        body: String,
        sound: String? = nil,
        priority: OmnipolymathNotificationPriority? = nil,
        delivery: OmnipolymathNotificationDelivery? = nil)
    {
        self.title = title
        self.body = body
        self.sound = sound
        self.priority = priority
        self.delivery = delivery
    }
}
