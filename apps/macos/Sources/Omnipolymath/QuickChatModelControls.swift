import Foundation
import OmnipolymathChatUI
import OmnipolymathKit
import OmnipolymathProtocol

struct QuickChatModelControlSnapshot: Sendable {
    let models: [OmnipolymathChatModelChoice]
    let currentModelSelectionID: String?
    let currentThinkingLevel: String?
    let thinkingOptions: [OmnipolymathChatThinkingLevelOption]
    let defaultProvider: String?
    var modelSelectionPolicy: OmnipolymathChatModelSelectionPolicy?
    var catalogMessage: String?
    var catalogRefreshFailed = false
    var speed = OmnipolymathChatFastModeProfile.resolve(session: nil, model: nil)
}

enum QuickChatModelPatchDecision: Equatable {
    case none
    case patch(String?)
}

enum QuickChatModelControlLogic {
    static func snapshot(
        target: OmnipolymathChatSessionTarget,
        models: [OmnipolymathChatModelChoice],
        sessions: OmnipolymathChatSessionsListResponse,
        agents: AgentsListResult?,
        modelSelectionPolicy: OmnipolymathChatModelSelectionPolicy? = nil) -> QuickChatModelControlSnapshot
    {
        let entry = self.sessionEntry(target: target, sessions: sessions.sessions)
        let agent = self.agent(target: target, agents: agents)
        let entryProvider = entry?.modelProvider?.trimmedNonEmpty
        let entryModel = entry?.model?.trimmedNonEmpty
        let agentModel = (agent?.model?["primary"]?.value as? String)?.trimmedNonEmpty
        let defaultProvider = sessions.defaults?.modelProvider?.trimmedNonEmpty
        let defaultModel = sessions.defaults?.model?.trimmedNonEmpty
        let automaticModel = if let policy = modelSelectionPolicy, policy.restricted {
            policy.defaultModel
        } else {
            agentModel ?? defaultModel.map { self.selectionID(model: $0, provider: defaultProvider) }
        }
        let entrySelectionID = entryModel.map {
            self.selectionID(model: $0, provider: entryProvider ?? defaultProvider)
        }
        let currentSelectionID = if modelSelectionPolicy?.restricted == true {
            entrySelectionID.flatMap { selection in
                models.contains(where: { $0.selectionID == selection }) ? selection : nil
            }
        } else {
            entrySelectionID
        }
        let selectionID = currentSelectionID ?? automaticModel
        let profile = OmnipolymathChatThinkingProfile.resolve(
            session: modelSelectionPolicy?.restricted == true && selectionID != entrySelectionID ? nil : entry,
            defaults: selectionID == defaultModel.map { self.selectionID(model: $0, provider: defaultProvider) }
                ? sessions.defaults : nil,
            model: models.first { $0.selectionID == selectionID })
        let thinkingLevel = entry?.thinkingLevel?.trimmedNonEmpty ?? profile?.defaultLevel
        return QuickChatModelControlSnapshot(
            models: models,
            currentModelSelectionID: selectionID,
            currentThinkingLevel: thinkingLevel,
            thinkingOptions: profile?.levels ?? [],
            defaultProvider: self.provider(selectionID: selectionID),
            modelSelectionPolicy: modelSelectionPolicy,
            speed: .resolve(session: entry, model: models.first { $0.selectionID == selectionID }))
    }

    static func modelPatchDecision(
        selectionID: String?,
        appliedSelectionID: String?,
        currentSessionSelectionID: String? = nil) -> QuickChatModelPatchDecision
    {
        guard let selectionID else { return .none }
        let isDefault = selectionID == OmnipolymathChatViewModel.defaultModelSelectionID
        let current = isDefault ? appliedSelectionID : (currentSessionSelectionID ?? appliedSelectionID)
        guard selectionID != current else { return .none }
        return .patch(isDefault ? nil : selectionID)
    }

    static func displayName(
        selectionID: String?,
        models: [OmnipolymathChatModelChoice],
        automaticLabel: String) -> String
    {
        guard let selectionID,
              selectionID != OmnipolymathChatViewModel.defaultModelSelectionID
        else { return automaticLabel }
        if let choice = models.first(where: { $0.selectionID == selectionID }) {
            return choice.name
        }
        return selectionID.split(separator: "/", maxSplits: 1).last.map(String.init) ?? selectionID
    }

    static func validatedThinkingSelection(
        _ selection: String?,
        options: [OmnipolymathChatThinkingLevelOption]) -> String?
    {
        guard let selection else { return nil }
        let normalized = selection.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return options.contains(where: {
            $0.id.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == normalized
        }) ? normalized : nil
    }

    private static func sessionEntry(
        target: OmnipolymathChatSessionTarget,
        sessions: [OmnipolymathChatSessionEntry]) -> OmnipolymathChatSessionEntry?
    {
        let key = target.sessionKey.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let exact = sessions.first(where: { $0.key.lowercased() == key }) {
            return exact
        }
        guard key == "global",
              let agentID = target.agentID?.trimmedNonEmpty?.lowercased()
        else { return nil }
        return sessions.first(where: { $0.key.lowercased() == "agent:\(agentID):global" })
    }

    private static func agent(target: OmnipolymathChatSessionTarget, agents: AgentsListResult?) -> AgentSummary? {
        guard let agents else { return nil }
        let targetAgentID = target.agentID?.trimmedNonEmpty ??
            OmnipolymathChatSessionKey.agentID(from: target.sessionKey) ??
            agents.defaultid.trimmedNonEmpty
        guard let targetAgentID else { return nil }
        return agents.agents.first(where: { $0.id.caseInsensitiveCompare(targetAgentID) == .orderedSame })
    }

    static func selectionID(model: String, provider: String?) -> String {
        guard let provider else { return model }
        let prefix = "\(provider)/"
        return model.hasPrefix(prefix) ? model : "\(prefix)\(model)"
    }

    private static func provider(selectionID: String?) -> String? {
        guard let selectionID,
              let separator = selectionID.firstIndex(of: "/"),
              separator != selectionID.startIndex
        else { return nil }
        return String(selectionID[..<separator])
    }
}
