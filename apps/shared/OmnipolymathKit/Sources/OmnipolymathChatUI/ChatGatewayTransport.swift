import Foundation
import OmnipolymathKit
import OmnipolymathProtocol

/// Shared RPC application layer. Platform adapters retain route acquisition,
/// dispatch fencing, event subscriptions, and their session-target policy.
public protocol OmnipolymathChatGatewayTransport: OmnipolymathChatTransport {
    var chatGatewayAgentID: String? { get }
    func sessionTarget(for sessionKey: String, overrideAgentID: String?) -> OmnipolymathChatSessionTarget
    func requestChatGateway(_ request: OmnipolymathChatGatewayRequest) async throws -> Data
    func requestChatSessionAction(_ request: OmnipolymathChatGatewayRequest) async throws -> Data
}

extension OmnipolymathChatGatewayTransport {
    public var supportsSlashCommandCatalog: Bool {
        true
    }

    public func reactionsRouteLease(
        routeID: UUID,
        access: OmnipolymathChatReactionAccess,
        isCurrent: @escaping @Sendable () async -> Bool,
        request: @escaping @Sendable (OmnipolymathChatGatewayRequest) async throws -> Data)
        -> OmnipolymathChatReactionsRouteLease
    {
        OmnipolymathChatReactionsRouteLease(
            routeID: routeID,
            access: access,
            isCurrent: isCurrent,
            list: { sessionKey, agentID in
                let target = self.sessionTarget(for: sessionKey, overrideAgentID: agentID)
                let data = try await request(OmnipolymathChatGatewayRequests.reactionsList(
                    sessionKey: target.sessionKey,
                    agentID: target.agentID))
                return try OmnipolymathChatGatewayPayloadCodec.decodeReactionsList(data)
            },
            set: { sessionKey, agentID, messageID, emoji, remove in
                let target = self.sessionTarget(for: sessionKey, overrideAgentID: agentID)
                let data = try await request(OmnipolymathChatGatewayRequests.reactionsSet(
                    sessionKey: target.sessionKey,
                    agentID: target.agentID,
                    messageID: messageID,
                    emoji: emoji,
                    remove: remove))
                return try OmnipolymathChatGatewayPayloadCodec.decodeReactionsSet(data)
            })
    }

    public func requestChatSessionAction(_ request: OmnipolymathChatGatewayRequest) async throws -> Data {
        try await self.requestChatGateway(request)
    }

    public func abortRun(sessionKey: String, runId: String) async throws {
        let target = self.sessionTarget(for: sessionKey, overrideAgentID: nil)
        let request = OmnipolymathChatGatewayRequests.abortRun(
            sessionKey: target.sessionKey,
            agentID: target.agentID,
            runID: runId)
        _ = try await self.requestChatGateway(request)
    }

    public func deleteSession(key: String) async throws {
        let target = self.sessionTarget(for: key, overrideAgentID: nil)
        let request = OmnipolymathChatGatewayRequests.deleteSession(
            sessionKey: target.sessionKey,
            agentID: target.agentID)
        _ = try await self.requestChatGateway(request)
    }

    public func setActiveSessionKey(_ sessionKey: String) async throws {
        let target = self.sessionTarget(for: sessionKey, overrideAgentID: nil)
        let request = OmnipolymathChatGatewayRequests.subscribeSessionMessages(
            sessionKey: target.sessionKey,
            agentID: target.agentID)
        _ = try await self.requestChatGateway(request)
    }

    public func resetSession(sessionKey: String) async throws {
        let target = self.sessionTarget(for: sessionKey, overrideAgentID: nil)
        let request = OmnipolymathChatGatewayRequests.resetSession(
            sessionKey: target.sessionKey,
            agentID: target.agentID)
        _ = try await self.requestChatGateway(request)
    }

    public func listCommands(sessionKey: String) async throws -> [OmnipolymathChatCommandChoice] {
        let request = OmnipolymathChatGatewayRequests.commandsList(
            sessionKey: sessionKey,
            fallbackAgentID: self.chatGatewayAgentID)
        let data = try await self.requestChatGateway(request)
        let decoded = try JSONDecoder().decode(CommandsListResult.self, from: data)
        return decoded.commands.map(OmnipolymathChatGatewayPayloadCodec.commandChoice)
    }

    public func listQuestions() async throws -> [QuestionRecord] {
        let data = try await self.requestChatGateway(OmnipolymathChatGatewayRequests.questionList())
        return try JSONDecoder().decode(QuestionListResult.self, from: data).questions
    }

    public func getQuestion(id: String) async throws -> QuestionRecord {
        let data = try await self.requestChatGateway(OmnipolymathChatGatewayRequests.questionGet(id: id))
        return try JSONDecoder().decode(QuestionGetResult.self, from: data).question
    }

    public func resolveQuestion(
        id: String,
        answers: [String: [String]],
        secretStoreAllowedHosts: [String]?) async throws -> QuestionAnswers
    {
        let data = try await self.requestChatGateway(OmnipolymathChatGatewayRequests.resolveQuestion(
            id: id,
            answers: answers,
            secretStoreAllowedHosts: secretStoreAllowedHosts))
        return try OmnipolymathChatGatewayPayloadCodec.decodeQuestionAnswer(data)
    }

    public func cancelQuestion(id: String) async throws {
        _ = try await self.requestChatGateway(
            OmnipolymathChatGatewayRequests.cancelQuestion(id: id))
    }

    public func setSessionThinking(sessionKey: String, thinkingLevel: String) async throws {
        let target = self.sessionTarget(for: sessionKey, overrideAgentID: nil)
        _ = try await self.patchSessionSettings(
            sessionKey: target.sessionKey,
            agentID: target.agentID,
            patch: OmnipolymathChatSessionSettingsPatch(thinkingLevel: .some(thinkingLevel)))
    }

    public func patchSessionModel(
        sessionKey: String,
        agentID: String?,
        model: String?) async throws -> OmnipolymathChatModelPatchResult?
    {
        try await self.patchSessionSettings(
            sessionKey: sessionKey,
            agentID: agentID,
            patch: OmnipolymathChatSessionSettingsPatch(model: .some(model)))
    }

    public func createSession(
        key: String,
        label: String?,
        parentSessionKey: String?,
        worktree: Bool?) async throws -> OmnipolymathChatCreateSessionResponse
    {
        try await self.createSession(
            key: key,
            label: label,
            agentID: nil,
            parentSessionKey: parentSessionKey,
            worktree: worktree,
            worktreeBaseRef: nil)
    }

    public func rewindSession(
        sessionKey: String,
        entryId: String) async throws -> OmnipolymathChatRewindResponse
    {
        let target = self.sessionTarget(for: sessionKey, overrideAgentID: nil)
        let request = OmnipolymathChatGatewayRequests.rewindSession(
            sessionKey: target.sessionKey,
            agentID: target.agentID,
            entryId: entryId)
        let data = try await self.requestChatSessionAction(request)
        return try JSONDecoder().decode(OmnipolymathChatRewindResponse.self, from: data)
    }

    public func forkSession(parentKey: String) async throws -> String {
        try await self.forkSession(parentKey: parentKey, fromLastCompleted: false)
    }

    public func forkSession(parentKey: String, fromLastCompleted: Bool) async throws -> String {
        try await self.forkSession(parentKey: parentKey, fromLastCompleted: fromLastCompleted, agentID: nil)
    }

    public func forkSession(parentKey: String, fromLastCompleted: Bool, agentID: String?) async throws -> String {
        let target = self.sessionTarget(for: parentKey, overrideAgentID: agentID)
        let request = OmnipolymathChatGatewayRequests.forkSession(
            parentSessionKey: target.sessionKey,
            agentID: target.agentID,
            fromLastCompleted: fromLastCompleted)
        let data = try await self.requestChatSessionAction(request)
        return try JSONDecoder().decode(OmnipolymathChatCreateSessionResponse.self, from: data).key
    }

    public func forkSessionAtMessage(
        sessionKey: String,
        entryId: String) async throws -> OmnipolymathChatForkAtMessageResponse
    {
        let target = self.sessionTarget(for: sessionKey, overrideAgentID: nil)
        let request = OmnipolymathChatGatewayRequests.forkAtMessage(
            sessionKey: target.sessionKey,
            agentID: target.agentID,
            entryId: entryId)
        let data = try await self.requestChatSessionAction(request)
        return try JSONDecoder().decode(OmnipolymathChatForkAtMessageResponse.self, from: data)
    }

    public func listSessionBranches(
        sessionKey: String,
        agentID: String?) async throws -> OmnipolymathChatSessionBranchesResponse
    {
        let target = self.sessionTarget(for: sessionKey, overrideAgentID: agentID)
        let request = OmnipolymathChatGatewayRequests.listSessionBranches(
            sessionKey: target.sessionKey,
            agentID: target.agentID)
        let data = try await self.requestChatSessionAction(request)
        return try JSONDecoder().decode(OmnipolymathChatSessionBranchesResponse.self, from: data)
    }

    public func switchSessionBranch(sessionKey: String, agentID: String?, leafEntryId: String) async throws {
        let target = self.sessionTarget(for: sessionKey, overrideAgentID: nil)
        let request = OmnipolymathChatGatewayRequests.switchSessionBranch(
            sessionKey: target.sessionKey,
            agentID: agentID ?? target.agentID,
            leafEntryId: leafEntryId)
        _ = try await self.requestChatSessionAction(request)
    }
}
