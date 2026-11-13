import Foundation

public enum OmnipolymathRemindersCommand: String, Codable, Sendable {
    case list = "reminders.list"
    case add = "reminders.add"
}

public enum OmnipolymathReminderStatusFilter: String, Codable, Sendable {
    case incomplete
    case completed
    case all
}

public struct OmnipolymathRemindersListParams: Codable, Sendable, Equatable {
    public var status: OmnipolymathReminderStatusFilter?
    public var limit: Int?

    public init(status: OmnipolymathReminderStatusFilter? = nil, limit: Int? = nil) {
        self.status = status
        self.limit = limit
    }
}

public struct OmnipolymathRemindersAddParams: Codable, Sendable, Equatable {
    public var title: String
    public var dueISO: String?
    public var notes: String?
    public var listId: String?
    public var listName: String?

    public init(
        title: String,
        dueISO: String? = nil,
        notes: String? = nil,
        listId: String? = nil,
        listName: String? = nil)
    {
        self.title = title
        self.dueISO = dueISO
        self.notes = notes
        self.listId = listId
        self.listName = listName
    }
}

public struct OmnipolymathReminderPayload: Codable, Sendable, Equatable {
    public var identifier: String
    public var title: String
    public var dueISO: String?
    public var completed: Bool
    public var listName: String?
    public var notes: String?

    public init(
        identifier: String,
        title: String,
        dueISO: String? = nil,
        completed: Bool,
        listName: String? = nil,
        notes: String? = nil)
    {
        self.identifier = identifier
        self.title = title
        self.dueISO = dueISO
        self.completed = completed
        self.listName = listName
        self.notes = notes
    }
}

public struct OmnipolymathRemindersListPayload: Codable, Sendable, Equatable {
    public var reminders: [OmnipolymathReminderPayload]

    public init(reminders: [OmnipolymathReminderPayload]) {
        self.reminders = reminders
    }
}

public struct OmnipolymathRemindersAddPayload: Codable, Sendable, Equatable {
    public var reminder: OmnipolymathReminderPayload

    public init(reminder: OmnipolymathReminderPayload) {
        self.reminder = reminder
    }
}
