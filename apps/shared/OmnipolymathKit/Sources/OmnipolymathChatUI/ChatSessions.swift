import Foundation
import OmnipolymathProtocol

public struct OmnipolymathChatSessionAgentStatus: Codable, Sendable, Hashable {
    public let note: String
    public let expiresAt: Double
    public let attention: String?
}

public struct OmnipolymathChatSessionObserverDigest: Codable, Sendable, Hashable {
    public let agentId: String?
    public let runId: String?
    public let revision: Int
    public let updatedAt: Double
    public let headline: String
    public let health: String

    public init(
        agentId: String? = nil,
        runId: String? = nil,
        revision: Int,
        updatedAt: Double,
        headline: String,
        health: String)
    {
        self.agentId = agentId
        self.runId = runId
        self.revision = revision
        self.updatedAt = updatedAt
        self.headline = headline
        self.health = health
    }

    public init(_ digest: SessionObserverDigest) {
        self.init(
            agentId: digest.agentid,
            runId: digest.runid,
            revision: digest.revision,
            updatedAt: Double(digest.updatedat),
            headline: digest.headline,
            health: digest.health.rawValue)
    }
}

public struct OmnipolymathChatThinkingLevelOption: Codable, Identifiable, Sendable, Hashable {
    public let id: String
    public let label: String

    public init(id: String, label: String) {
        self.id = id
        self.label = label
    }
}

public struct OmnipolymathChatThinkingProfile: Sendable {
    public let levels: [OmnipolymathChatThinkingLevelOption]?
    public let defaultLevel: String?

    public static func resolve(
        session: OmnipolymathChatSessionEntry?,
        defaults: OmnipolymathChatSessionsDefaults?,
        model: OmnipolymathChatModelChoice?) -> Self?
    {
        if let profile = self.profile(
            levels: session?.thinkingLevels,
            legacyOptions: session?.thinkingOptions,
            defaultLevel: session?.thinkingDefault)
        {
            return profile
        }
        let defaultsMatch = (session?.modelProvider == nil || session?.modelProvider == defaults?.modelProvider) &&
            (session?.model == nil || session?.model == defaults?.model) &&
            self.routesMatch(session?.agentRuntime, defaults?.agentRuntime)
        if defaultsMatch, let profile = self.profile(
            levels: defaults?.thinkingLevels,
            legacyOptions: defaults?.thinkingOptions,
            defaultLevel: defaults?.thinkingDefault)
        {
            return profile
        }
        guard self.routesMatch(session?.agentRuntime, model?.agentRuntime) else { return nil }
        return self.profile(levels: model?.thinkingLevels, legacyOptions: nil, defaultLevel: model?.thinkingDefault)
    }

    private static func routesMatch(_ session: OmnipolymathChatAgentRuntime?, _ other: OmnipolymathChatAgentRuntime?) -> Bool {
        session?.id == nil || other?.id == nil || session?.id == other?.id
    }

    private static func profile(
        levels: [OmnipolymathChatThinkingLevelOption]?, legacyOptions: [String]?, defaultLevel: String?) -> Self?
    {
        guard levels != nil || legacyOptions != nil || defaultLevel != nil else { return nil }
        return Self(
            levels: levels ?? legacyOptions?.map { .init(id: $0.lowercased(), label: $0) },
            defaultLevel: defaultLevel)
    }
}

public enum OmnipolymathChatFastMode: Sendable, Equatable, Hashable, Codable {
    case off
    case on
    case automatic
    case ultrafast

    public var isEnabled: Bool {
        self != .off
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let enabled = try? container.decode(Bool.self) {
            self = enabled ? .on : .off
            return
        }
        switch try container.decode(String.self).lowercased() {
        case "auto":
            self = .automatic
        case "ultrafast":
            self = .ultrafast
        default:
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid fast mode")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .off:
            try container.encode(false)
        case .on:
            try container.encode(true)
        case .automatic:
            try container.encode("auto")
        case .ultrafast:
            try container.encode("ultrafast")
        }
    }
}

public struct OmnipolymathChatFastModeProfile: Sendable, Equatable {
    public let supportsFastMode: Bool
    public let override: OmnipolymathChatFastMode?
    public let effective: OmnipolymathChatFastMode?

    public var isEnabled: Bool {
        self.effective?.isEnabled == true
    }

    public var showsControls: Bool {
        self.supportsFastMode || self.override != nil
    }

    public static func resolve(
        session: OmnipolymathChatSessionEntry?,
        model: OmnipolymathChatModelChoice?) -> Self
    {
        Self(
            supportsFastMode: model?.supportsFastMode == true,
            override: session?.fastMode,
            effective: session?.effectiveFastMode ?? session?.fastMode ?? model?.effectiveFastMode)
    }
}

public struct OmnipolymathChatModelChoice: Identifiable, Codable, Sendable, Hashable {
    public var id: String {
        self.selectionID
    }

    public let modelID: String
    public let name: String
    public let provider: String
    public let available: Bool?
    public let manualSelectionAllowed: Bool?
    public let unavailableReason: String?
    public let unavailableUntil: Int?
    public let contextWindow: Int?
    public let reasoning: Bool?
    public let supportsFastMode: Bool?
    public let effectiveFastMode: OmnipolymathChatFastMode?
    public let thinkingLevels: [OmnipolymathChatThinkingLevelOption]?
    public let thinkingDefault: String?
    public let input: [String]?
    public let agentRuntime: OmnipolymathChatAgentRuntime?

    public init(
        modelID: String,
        name: String,
        provider: String,
        available: Bool? = nil,
        manualSelectionAllowed: Bool? = nil,
        unavailableReason: String? = nil,
        unavailableUntil: Int? = nil,
        contextWindow: Int?,
        reasoning: Bool? = nil,
        supportsFastMode: Bool? = nil,
        effectiveFastMode: OmnipolymathChatFastMode? = nil,
        thinkingLevels: [OmnipolymathChatThinkingLevelOption]? = nil,
        thinkingDefault: String? = nil,
        input: [String]? = nil,
        agentRuntime: OmnipolymathChatAgentRuntime? = nil)
    {
        self.modelID = modelID
        self.name = name
        self.provider = provider
        self.available = available
        self.manualSelectionAllowed = manualSelectionAllowed
        self.unavailableReason = unavailableReason
        self.unavailableUntil = unavailableUntil
        self.contextWindow = contextWindow
        self.reasoning = reasoning
        self.supportsFastMode = supportsFastMode
        self.effectiveFastMode = effectiveFastMode
        self.thinkingLevels = thinkingLevels
        self.thinkingDefault = thinkingDefault
        self.input = input
        self.agentRuntime = agentRuntime
    }

    /// Provider-qualified model ref used for picker identity and selection tags.
    public var selectionID: String {
        let trimmedProvider = self.provider.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedProvider.isEmpty else { return self.modelID }
        let providerPrefix = "\(trimmedProvider)/"
        if self.modelID.hasPrefix(providerPrefix) {
            return self.modelID
        }
        return "\(trimmedProvider)/\(self.modelID)"
    }

    public var displayLabel: String {
        self.selectionID
    }

    public var availabilityReason: OmnipolymathChatModelUnavailableReason? {
        OmnipolymathChatModelUnavailableReason(rawValue: self.unavailableReason)
    }

    public var capabilityDescription: String {
        var labels = (self.input ?? []).filter { $0 != "text" }.map { input in
            switch input {
            case "image": String(localized: "Images")
            case "audio": String(localized: "Audio")
            case "video": String(localized: "Video")
            case "document": String(localized: "Documents")
            default: input
            }
        }
        if let route = self.agentRuntime, route.source == "model" || route.source == "provider" {
            labels.append(route.id)
        }
        return labels.joined(separator: " · ")
    }
}

public enum OmnipolymathChatModelUnavailableReason: Sendable, Equatable, Hashable {
    case missingAuth
    case authFailed
    case cooldown
    case unknown(String)

    public init?(rawValue: String?) {
        guard let value = rawValue?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !value.isEmpty
        else { return nil }
        switch value {
        case "missing-auth": self = .missingAuth
        case "auth-failed": self = .authFailed
        case "cooldown": self = .cooldown
        default: self = .unknown(value)
        }
    }

    public var pickerDescription: String {
        switch self {
        case .missingAuth: String(localized: "Sign-in needed")
        case .authFailed: String(localized: "Authentication failed")
        case .cooldown: String(localized: "Cooling down")
        case .unknown: String(localized: "Unavailable")
        }
    }

    var blocksSend: Bool {
        self == .missingAuth || self == .authFailed
    }
}

public struct OmnipolymathChatSessionSettingsPatch: Sendable, Equatable {
    /// Outer optional means unchanged; inner optional clears the override.
    public let expectedSessionID: String?
    public let expectedPermissionMode: OmnipolymathChatPermissionMode??
    public let expectedToolOverrides: OmnipolymathChatSessionToolOverrides??
    public let model: String??
    public let thinkingLevel: String??
    public let fastMode: OmnipolymathChatFastMode??
    public let verboseLevel: String??
    public let permissionMode: OmnipolymathChatPermissionMode??
    public let toolOverrides: OmnipolymathChatSessionToolOverrides??

    public var requiresSessionSettingsContract: Bool {
        self.expectedSessionID != nil || self.permissionMode != nil || self.toolOverrides != nil
    }

    public var requiresSessionSettingsCAS: Bool {
        self.expectedPermissionMode != nil || self.expectedToolOverrides != nil ||
            self.permissionMode != nil || self.toolOverrides != nil
    }

    public init(
        expectedSessionID: String? = nil,
        expectedPermissionMode: OmnipolymathChatPermissionMode?? = nil,
        expectedToolOverrides: OmnipolymathChatSessionToolOverrides?? = nil,
        model: String?? = nil,
        thinkingLevel: String?? = nil,
        fastMode: OmnipolymathChatFastMode?? = nil,
        verboseLevel: String?? = nil,
        permissionMode: OmnipolymathChatPermissionMode?? = nil,
        toolOverrides: OmnipolymathChatSessionToolOverrides?? = nil)
    {
        self.expectedSessionID = expectedSessionID
        self.expectedPermissionMode = expectedPermissionMode
        self.expectedToolOverrides = expectedToolOverrides
        self.model = model
        self.thinkingLevel = thinkingLevel
        self.fastMode = fastMode
        self.verboseLevel = verboseLevel
        self.permissionMode = permissionMode
        self.toolOverrides = toolOverrides
    }

    func withExpectedSessionID(
        _ expectedSessionID: String,
        expectedPermissionMode: OmnipolymathChatPermissionMode?? = nil,
        expectedToolOverrides: OmnipolymathChatSessionToolOverrides?? = nil) -> Self
    {
        Self(
            expectedSessionID: expectedSessionID,
            expectedPermissionMode: expectedPermissionMode,
            expectedToolOverrides: expectedToolOverrides,
            model: self.model,
            thinkingLevel: self.thinkingLevel,
            fastMode: self.fastMode,
            verboseLevel: self.verboseLevel,
            permissionMode: self.permissionMode,
            toolOverrides: self.toolOverrides)
    }
}

/// Authority-bearing session settings a chat turn must still match at admission.
public struct OmnipolymathChatSessionSettingsExpectation: Codable, Hashable, Sendable {
    public let permissionMode: OmnipolymathChatPermissionMode?
    public let toolOverrides: OmnipolymathChatSessionToolOverrides?

    public init(
        permissionMode: OmnipolymathChatPermissionMode?,
        toolOverrides: OmnipolymathChatSessionToolOverrides?)
    {
        self.permissionMode = permissionMode
        self.toolOverrides = toolOverrides
    }
}

public enum OmnipolymathChatQueueMode: String, Codable, Hashable, Sendable {
    case steer
    case followup
}

public struct OmnipolymathChatSendTarget: Hashable, Sendable {
    public let agentID: String?
    public let expectedSessionRoutingContract: String?
    public let expectedSessionSettings: OmnipolymathChatSessionSettingsExpectation?
    public let queueMode: OmnipolymathChatQueueMode?

    public init(
        agentID: String?,
        expectedSessionRoutingContract: String?,
        expectedSessionSettings: OmnipolymathChatSessionSettingsExpectation?,
        queueMode: OmnipolymathChatQueueMode? = nil)
    {
        self.agentID = agentID
        self.expectedSessionRoutingContract = expectedSessionRoutingContract
        self.expectedSessionSettings = expectedSessionSettings
        self.queueMode = queueMode
    }
}

/// Authoritative model identity and thinking state returned by `sessions.patch`.
public struct OmnipolymathChatModelPatchResult: Decodable, Sendable, Equatable {
    public let key: String?
    public let modelProvider: String?
    public let model: String?
    public let thinkingLevel: String?
    public let thinkingLevels: [OmnipolymathChatThinkingLevelOption]?
    public let fastMode: OmnipolymathChatFastMode?
    public let effectiveFastMode: OmnipolymathChatFastMode?
    public let verboseLevel: String?
    public let permissionMode: OmnipolymathChatPermissionMode?
    public let toolOverrides: OmnipolymathChatSessionToolOverrides?

    public init(
        key: String? = nil,
        modelProvider: String?,
        model: String?,
        thinkingLevel: String?,
        thinkingLevels: [OmnipolymathChatThinkingLevelOption]? = nil,
        fastMode: OmnipolymathChatFastMode? = nil,
        effectiveFastMode: OmnipolymathChatFastMode? = nil,
        verboseLevel: String? = nil,
        permissionMode: OmnipolymathChatPermissionMode? = nil,
        toolOverrides: OmnipolymathChatSessionToolOverrides? = nil)
    {
        self.key = key
        self.modelProvider = modelProvider
        self.model = model
        self.thinkingLevel = thinkingLevel
        self.thinkingLevels = thinkingLevels
        self.fastMode = fastMode
        self.effectiveFastMode = effectiveFastMode
        self.verboseLevel = verboseLevel
        self.permissionMode = permissionMode
        self.toolOverrides = toolOverrides
    }

    private enum CodingKeys: String, CodingKey {
        case key
        case entry
        case resolved
    }

    private enum EntryKeys: String, CodingKey {
        case modelProvider
        case model
        case providerOverride
        case modelOverride
        case thinkingLevel
        case thinkingLevels
        case fastMode
        case effectiveFastMode
        case verboseLevel
        case permissionMode
        case toolOverrides
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let entry = try container.nestedContainer(keyedBy: EntryKeys.self, forKey: .entry)
        self.key = try container.decodeIfPresent(String.self, forKey: .key)
        let entryModelProvider = try entry.decodeIfPresent(String.self, forKey: .modelProvider)
            ?? entry.decodeIfPresent(String.self, forKey: .providerOverride)
        let entryModel = try entry.decodeIfPresent(String.self, forKey: .model)
            ?? entry.decodeIfPresent(String.self, forKey: .modelOverride)
        let entryThinkingLevel = try entry.decodeIfPresent(String.self, forKey: .thinkingLevel)
        let entryFastMode = try entry.decodeIfPresent(OmnipolymathChatFastMode.self, forKey: .fastMode)
        let entryEffectiveFastMode = try entry.decodeIfPresent(
            OmnipolymathChatFastMode.self,
            forKey: .effectiveFastMode)
        let entryVerboseLevel = try entry.decodeIfPresent(String.self, forKey: .verboseLevel)
        let entryPermissionMode = try entry.decodeIfPresent(
            OmnipolymathChatPermissionMode.self,
            forKey: .permissionMode)
        let entryToolOverrides = try entry.decodeIfPresent(
            OmnipolymathChatSessionToolOverrides.self,
            forKey: .toolOverrides)
        let resolved = try container.contains(.resolved)
            ? container.nestedContainer(keyedBy: EntryKeys.self, forKey: .resolved) : nil
        self.modelProvider = try resolved?.decodeIfPresent(String.self, forKey: .modelProvider) ?? entryModelProvider
        self.model = try resolved?.decodeIfPresent(String.self, forKey: .model) ?? entryModel
        self.thinkingLevel = try resolved?.decodeIfPresent(String.self, forKey: .thinkingLevel) ?? entryThinkingLevel
        self.thinkingLevels = try resolved?.decodeIfPresent(
            [OmnipolymathChatThinkingLevelOption].self,
            forKey: .thinkingLevels)
        self.fastMode = try resolved?.decodeIfPresent(OmnipolymathChatFastMode.self, forKey: .fastMode) ?? entryFastMode
        self.effectiveFastMode = try resolved?.decodeIfPresent(
            OmnipolymathChatFastMode.self, forKey: .effectiveFastMode) ?? entryEffectiveFastMode
        self.verboseLevel = try resolved?.decodeIfPresent(String.self, forKey: .verboseLevel) ?? entryVerboseLevel
        self.permissionMode = try resolved?.decodeIfPresent(
            OmnipolymathChatPermissionMode.self, forKey: .permissionMode) ?? entryPermissionMode
        self.toolOverrides = try resolved?.decodeIfPresent(
            OmnipolymathChatSessionToolOverrides.self, forKey: .toolOverrides) ?? entryToolOverrides
    }
}

public struct OmnipolymathChatSessionsDefaults: Codable, Sendable {
    public let agentRuntime: OmnipolymathChatAgentRuntime?
    public let modelProvider: String?
    public let model: String?
    public let modelSelectionTarget: String?
    public let contextTokens: Int?
    public let thinkingLevels: [OmnipolymathChatThinkingLevelOption]?
    public let thinkingOptions: [String]?
    public let thinkingDefault: String?
    public var mainSessionKey: String?

    public init(
        modelProvider: String? = nil,
        model: String?,
        contextTokens: Int?,
        thinkingLevels: [OmnipolymathChatThinkingLevelOption]? = nil,
        thinkingOptions: [String]? = nil,
        thinkingDefault: String? = nil,
        mainSessionKey: String? = nil,
        modelSelectionTarget: String? = nil,
        agentRuntime: OmnipolymathChatAgentRuntime? = nil)
    {
        self.modelProvider = modelProvider
        self.agentRuntime = agentRuntime
        self.model = model
        self.modelSelectionTarget = modelSelectionTarget
        self.contextTokens = contextTokens
        self.thinkingLevels = thinkingLevels
        self.thinkingOptions = thinkingOptions
        self.thinkingDefault = thinkingDefault
        self.mainSessionKey = mainSessionKey
    }
}

public struct OmnipolymathChatSessionWorktree: Codable, Sendable, Hashable {
    public let id: String?
    public let branch: String?
    public let repoRoot: String?

    public init(id: String?, branch: String?, repoRoot: String?) {
        self.id = id
        self.branch = branch
        self.repoRoot = repoRoot
    }
}

public struct OmnipolymathChatAgentRuntime: Codable, Sendable, Hashable {
    public let id: String
    public let fallback: String?
    public let source: String?
}

public struct OmnipolymathChatSessionGroup: Codable, Identifiable, Sendable, Hashable {
    public var id: String {
        self.name
    }

    public let name: String
    public let position: Int

    public init(name: String, position: Int) {
        self.name = name
        self.position = position
    }
}

public struct OmnipolymathChatSessionGroupsResponse: Codable, Sendable, Equatable {
    public let groups: [OmnipolymathChatSessionGroup]
    public var sectionOrder: [String]?
}

public struct OmnipolymathChatSessionGroupsMutationResponse: Codable, Sendable, Equatable {
    public let ok: Bool
    public let groups: [OmnipolymathChatSessionGroup]
    public let updatedSessions: Int?
}

public struct OmnipolymathChatSessionEntry: Codable, Identifiable, Sendable, Hashable {
    public struct CreatedActor: Codable, Sendable, Hashable {
        public let type: String
        public let id: String?
        public let label: String?
        public let avatarUrl: String?
        public let identity: AnyCodable?
    }

    public var id: String {
        self.key
    }

    public var key: String
    public var kind: String?
    public var displayName: String?
    public var derivedTitle: String?
    public var lastMessagePreview: String?
    public var icon: String?
    public var channel: String?
    public var channelAvatarUrl: String?
    public var origin: [String: AnyCodable]?
    public var chatType: String?
    public var groupChannel: String?
    public var deliveryContext: [String: AnyCodable]?
    public var owner: Owner?
    public var participants: [Participant]?
    public var expandedParticipants: [Participant]?
    public var participantCount: Int?
    public var visibility: SessionVisibility?
    public var sharingRole: SessionSharingRole?
    public var hiddenFromInvolvingMe: Bool?
    public var incognito: Bool?
    public var archivedBy: CreatedActor?
    public var archiveReason: String?
    public var projectId: String?
    public var workspaceDir: String?
    public var spawnedWorkspaceDir: String?
    public var spawnedCwd: String?
    public var repositoryWorkspaceId: String?
    public var repository: [String: AnyCodable]?
    public var execNode: String?
    public var execCwd: String?
    public var forkedFromParent: Bool?
    public var parentSessionId: String?
    public var controlOwnerSessionKey: String?
    public var forkSource: ForkSource?
    public var previousSessionId: String?
    public var spawnDepth: Double?
    public var subagentRole: String?
    public var subagentControlScope: String?
    public var placement: Placement?
    public var placementMove: PlacementMove?
    /// Non-sensitive facts derived by the Gateway from the canonical session route.
    public var classification: String?
    public var boardFace: String?
    public var agentId: String?
    public var accountId: String?
    public var peerKind: String?
    public var isMain: Bool?
    public var isBackground: Bool?
    public var label: String?
    /// Automatic device label; explicit labels and generated display names take precedence.
    public var autoLabel: String?
    public var category: String?
    public var color: String?
    public var pinned: Bool?
    public var pinnedAt: Double?
    public var archived: Bool?
    public var archivedAt: Double?
    public var snoozedUntil: Double?
    public var snoozedAt: Double?
    public var unread: Bool?
    public var agentStatus: OmnipolymathChatSessionAgentStatus?
    public var observerDigest: OmnipolymathChatSessionObserverDigest?
    public var surface: String?
    public var subject: String?
    public var room: String?
    public var space: String?
    public var createdAt: Double?
    public var createdActor: CreatedActor?
    public var createdVia: String?
    public var updatedAt: Double?
    public var lastReadAt: Double?
    public var markedUnreadAt: Double?
    public var lastInteractionAt: Double?
    public var lastActivityAt: Double?
    public var sessionId: String?

    public var parentSessionKey: String?
    public var spawnedBy: String?
    public var childSessions: [String]?
    public var status: String?
    public var lastRunError: String?
    public var hasActiveRun: Bool?
    public var activeRunIds: [String]?
    public var hasActiveSubagentRun: Bool?
    public var subagentRunState: String?
    public var swarmGroupId: String?
    public var swarmPhase: String?
    public var swarmPhaseRank: Int?
    public var swarmLog: String?
    public var worktree: OmnipolymathChatSessionWorktree?
    public var startedAt: Double?
    public var endedAt: Double?
    public var runtimeMs: Double?
    public var agentRuntime: OmnipolymathChatAgentRuntime?

    public var systemSent: Bool?
    public var abortedLastRun: Bool?
    public var thinkingLevel: String?
    public var reasoningLevel: String?
    public var verboseLevel: String?
    public var fastMode: OmnipolymathChatFastMode?
    public var effectiveFastMode: OmnipolymathChatFastMode?
    public var effectiveQueueMode: String?
    public var permissionMode: OmnipolymathChatPermissionMode?
    public var toolOverrides: OmnipolymathChatSessionToolOverrides?

    public var inputTokens: Int?
    public var outputTokens: Int?
    public var totalTokens: Int?
    public var totalTokensFresh: Bool?

    public var modelProvider: String?
    public var model: String?
    public var contextTokens: Int?
    public var thinkingLevels: [OmnipolymathChatThinkingLevelOption]?
    public var thinkingOptions: [String]?
    public var thinkingDefault: String?

    public init(
        key: String,
        kind: String? = nil,
        displayName: String? = nil,
        classification: String? = nil,
        boardFace: String? = nil,
        agentId: String? = nil,
        accountId: String? = nil,
        peerKind: String? = nil,
        isMain: Bool? = nil,
        isBackground: Bool? = nil,
        surface: String? = nil,
        subject: String? = nil,
        room: String? = nil,
        space: String? = nil,
        updatedAt: Double? = nil,
        sessionId: String? = nil,
        systemSent: Bool? = nil,
        abortedLastRun: Bool? = nil,
        thinkingLevel: String? = nil,
        verboseLevel: String? = nil,
        inputTokens: Int? = nil,
        outputTokens: Int? = nil,
        totalTokens: Int? = nil,
        totalTokensFresh: Bool? = nil,
        modelProvider: String? = nil,
        model: String? = nil,
        contextTokens: Int? = nil,
        thinkingLevels: [OmnipolymathChatThinkingLevelOption]? = nil,
        thinkingOptions: [String]? = nil,
        thinkingDefault: String? = nil,
        label: String? = nil,
        autoLabel: String? = nil,
        category: String? = nil,
        color: String? = nil,
        pinned: Bool? = nil,
        pinnedAt: Double? = nil,
        archived: Bool? = nil,
        archivedAt: Double? = nil,
        snoozedUntil: Double? = nil,
        snoozedAt: Double? = nil,
        unread: Bool? = nil,
        agentStatus: OmnipolymathChatSessionAgentStatus? = nil,
        observerDigest: OmnipolymathChatSessionObserverDigest? = nil,
        lastReadAt: Double? = nil,
        markedUnreadAt: Double? = nil,
        lastInteractionAt: Double? = nil,
        lastActivityAt: Double? = nil,
        parentSessionKey: String? = nil,
        spawnedBy: String? = nil,
        childSessions: [String]? = nil,
        status: String? = nil,
        lastRunError: String? = nil,
        hasActiveRun: Bool? = nil,
        activeRunIds: [String]? = nil,
        hasActiveSubagentRun: Bool? = nil,
        subagentRunState: String? = nil,
        swarmGroupId: String? = nil,
        swarmPhase: String? = nil,
        swarmPhaseRank: Int? = nil,
        swarmLog: String? = nil,
        worktree: OmnipolymathChatSessionWorktree? = nil,
        fastMode: OmnipolymathChatFastMode? = nil,
        effectiveFastMode: OmnipolymathChatFastMode? = nil,
        permissionMode: OmnipolymathChatPermissionMode? = nil,
        toolOverrides: OmnipolymathChatSessionToolOverrides? = nil,
        startedAt: Double? = nil,
        endedAt: Double? = nil,
        runtimeMs: Double? = nil,
        agentRuntime: OmnipolymathChatAgentRuntime? = nil,
        derivedTitle: String? = nil,
        effectiveQueueMode: String? = nil)
    {
        self.key = key
        self.kind = kind
        self.displayName = displayName
        self.derivedTitle = derivedTitle
        self.classification = classification
        self.boardFace = boardFace
        self.agentId = agentId
        self.accountId = accountId
        self.peerKind = peerKind
        self.isMain = isMain
        self.isBackground = isBackground
        self.label = label
        self.autoLabel = autoLabel
        self.category = category
        self.color = color
        self.pinned = pinned
        self.pinnedAt = pinnedAt
        self.archived = archived
        self.archivedAt = archivedAt
        self.snoozedUntil = snoozedUntil
        self.snoozedAt = snoozedAt
        self.unread = unread
        self.agentStatus = agentStatus
        self.observerDigest = observerDigest
        self.surface = surface
        self.subject = subject
        self.room = room
        self.space = space
        self.updatedAt = updatedAt
        self.lastReadAt = lastReadAt
        self.markedUnreadAt = markedUnreadAt
        self.lastInteractionAt = lastInteractionAt
        self.lastActivityAt = lastActivityAt
        self.sessionId = sessionId
        self.parentSessionKey = parentSessionKey
        self.spawnedBy = spawnedBy
        self.childSessions = childSessions
        self.status = status
        self.lastRunError = lastRunError
        self.hasActiveRun = hasActiveRun
        self.activeRunIds = activeRunIds
        self.hasActiveSubagentRun = hasActiveSubagentRun
        self.subagentRunState = subagentRunState
        self.swarmGroupId = swarmGroupId
        self.swarmPhase = swarmPhase
        self.swarmPhaseRank = swarmPhaseRank
        self.swarmLog = swarmLog
        self.worktree = worktree
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.runtimeMs = runtimeMs
        self.agentRuntime = agentRuntime
        self.systemSent = systemSent
        self.abortedLastRun = abortedLastRun
        self.thinkingLevel = thinkingLevel
        self.reasoningLevel = nil
        self.verboseLevel = verboseLevel
        self.fastMode = fastMode
        self.effectiveFastMode = effectiveFastMode
        self.effectiveQueueMode = effectiveQueueMode
        self.permissionMode = permissionMode
        self.toolOverrides = toolOverrides
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.totalTokens = totalTokens
        self.totalTokensFresh = totalTokensFresh
        self.modelProvider = modelProvider
        self.model = model
        self.contextTokens = contextTokens
        self.thinkingLevels = thinkingLevels
        self.thinkingOptions = thinkingOptions
        self.thinkingDefault = thinkingDefault
    }

    public var isPinned: Bool {
        self.pinned == true
    }

    public var isArchived: Bool {
        self.archived == true
    }

    public func isSnoozed(at now: Date = .now) -> Bool {
        guard let snoozedUntil, snoozedUntil.isFinite else { return false }
        return snoozedUntil / 1000 > now.timeIntervalSince1970
    }
}

/// Client-side session list policy shared by every session list surface.
/// Ordering mirrors the gateway (`pinnedAt` desc, `updatedAt` desc, key) so
/// cached/offline lists render in the same order as server responses.
public enum OmnipolymathChatSessionListOrganizer {
    public static func organize(_ sessions: [OmnipolymathChatSessionEntry]) -> [OmnipolymathChatSessionEntry] {
        sessions.sorted { lhs, rhs in
            let lhsPinnedAt = lhs.pinnedAt ?? (lhs.isPinned ? .greatestFiniteMagnitude : 0)
            let rhsPinnedAt = rhs.pinnedAt ?? (rhs.isPinned ? .greatestFiniteMagnitude : 0)
            if lhsPinnedAt != rhsPinnedAt {
                return lhsPinnedAt > rhsPinnedAt
            }
            let lhsUpdatedAt = lhs.updatedAt ?? 0
            let rhsUpdatedAt = rhs.updatedAt ?? 0
            if lhsUpdatedAt != rhsUpdatedAt {
                return lhsUpdatedAt > rhsUpdatedAt
            }
            return lhs.key < rhs.key
        }
    }

    /// Local fallback for the server-side `sessions.list` search when the
    /// gateway is unreachable and only cached entries are available.
    public static func filter(
        _ sessions: [OmnipolymathChatSessionEntry],
        search: String) -> [OmnipolymathChatSessionEntry]
    {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return sessions }
        return sessions.filter { session in
            [session.displayName, session.label, session.subject, session.sessionId, session.category, session.key]
                .contains { $0?.lowercased().contains(query) == true }
        }
    }
}

public struct OmnipolymathChatChildSessionsResult: Sendable {
    public let rows: [OmnipolymathChatSessionEntry]
    public let isComplete: Bool

    public init(rows: [OmnipolymathChatSessionEntry], isComplete: Bool) {
        self.rows = rows
        self.isComplete = isComplete
    }
}

public enum OmnipolymathChatChildSessionPager {
    private static let maxCollectedSessions = 100_000
    private static let maxPageRequests = 100

    public static func collect(
        fetchPage: (Int) async throws -> OmnipolymathChatSessionsListResponse) async throws
        -> OmnipolymathChatChildSessionsResult
    {
        var rowsByKey: [String: OmnipolymathChatSessionEntry] = [:]
        var expectedTotal: Int?
        var offset = 0
        for _ in 0..<Self.maxPageRequests {
            let page = try await fetchPage(offset)
            // Later omissions cannot certify a partial list.
            if let total = page.totalCount {
                expectedTotal = max(expectedTotal ?? 0, total)
            }
            for row in page.sessions {
                rowsByKey[row.key] = row
                if rowsByKey.count >= Self.maxCollectedSessions {
                    return OmnipolymathChatChildSessionsResult(rows: Array(rowsByKey.values), isComplete: false)
                }
            }
            // A moving list is best effort; callers already refresh or offer retry.
            let hasMore = page.hasMore ?? page.totalCount.map { offset + page.sessions.count < $0 } ?? false
            if !hasMore {
                return OmnipolymathChatChildSessionsResult(
                    rows: Array(rowsByKey.values), isComplete: expectedTotal.map { rowsByKey.count >= $0 } ?? true)
            }
            let nextOffset = page.nextOffset ?? ((page.offset ?? offset) + page.sessions.count)
            guard nextOffset > offset else { break }
            offset = nextOffset
        }
        return OmnipolymathChatChildSessionsResult(rows: Array(rowsByKey.values), isComplete: false)
    }
}

public struct OmnipolymathChatSessionsListResponse: Codable, Sendable {
    public let ts: Double?
    public let path: String?
    public var count: Int?
    public var totalCount: Int?
    public let offset: Int?
    public var nextOffset: Int?
    public var nextOffsetPresent: Bool
    public var hasMore: Bool?
    public let owners: [OmnipolymathChatSessionEntry.CreatedActor]?
    public let ownerSessionCounts: [SessionOwnerSessionCount]?
    public let people: [SessionPerson]?
    public let peopleIncomplete: Bool?
    public let peopleSessionCount: Int?
    public let involvingProfileId: String?
    public var defaults: OmnipolymathChatSessionsDefaults?
    public var sessions: [OmnipolymathChatSessionEntry]

    public init(
        ts: Double?,
        path: String?,
        count: Int?,
        totalCount: Int? = nil,
        offset: Int? = nil,
        nextOffset: Int? = nil,
        nextOffsetPresent: Bool? = nil,
        hasMore: Bool? = nil,
        owners: [OmnipolymathChatSessionEntry.CreatedActor]? = nil,
        ownerSessionCounts: [SessionOwnerSessionCount]? = nil,
        people: [SessionPerson]? = nil,
        peopleIncomplete: Bool? = nil,
        peopleSessionCount: Int? = nil,
        involvingProfileId: String? = nil,
        defaults: OmnipolymathChatSessionsDefaults?,
        sessions: [OmnipolymathChatSessionEntry])
    {
        self.ts = ts
        self.path = path
        self.count = count
        self.totalCount = totalCount
        self.offset = offset
        self.nextOffset = nextOffset
        self.nextOffsetPresent = nextOffsetPresent ?? (nextOffset != nil)
        self.hasMore = hasMore
        self.owners = owners
        self.ownerSessionCounts = ownerSessionCounts
        self.people = people
        self.peopleIncomplete = peopleIncomplete
        self.peopleSessionCount = peopleSessionCount
        self.involvingProfileId = involvingProfileId
        self.defaults = defaults
        self.sessions = sessions
    }

    private enum CodingKeys: String, CodingKey {
        case ts, path, count, totalCount, offset, nextOffset, hasMore, defaults, sessions
        case owners, ownerSessionCounts, people, peopleIncomplete, peopleSessionCount, involvingProfileId
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            ts: container.decodeIfPresent(Double.self, forKey: .ts),
            path: container.decodeIfPresent(String.self, forKey: .path),
            count: container.decodeIfPresent(Int.self, forKey: .count),
            totalCount: container.decodeIfPresent(Int.self, forKey: .totalCount),
            offset: container.decodeIfPresent(Int.self, forKey: .offset),
            nextOffset: container.decodeIfPresent(Int.self, forKey: .nextOffset),
            nextOffsetPresent: container.contains(.nextOffset),
            hasMore: container.decodeIfPresent(Bool.self, forKey: .hasMore),
            owners: container.decodeIfPresent([OmnipolymathChatSessionEntry.CreatedActor].self, forKey: .owners),
            ownerSessionCounts: container.decodeIfPresent([SessionOwnerSessionCount].self, forKey: .ownerSessionCounts),
            people: container.decodeIfPresent([SessionPerson].self, forKey: .people),
            peopleIncomplete: container.decodeIfPresent(Bool.self, forKey: .peopleIncomplete),
            peopleSessionCount: container.decodeIfPresent(Int.self, forKey: .peopleSessionCount),
            involvingProfileId: container.decodeIfPresent(String.self, forKey: .involvingProfileId),
            defaults: container.decodeIfPresent(OmnipolymathChatSessionsDefaults.self, forKey: .defaults),
            sessions: container.decode([OmnipolymathChatSessionEntry].self, forKey: .sessions))
    }
}
