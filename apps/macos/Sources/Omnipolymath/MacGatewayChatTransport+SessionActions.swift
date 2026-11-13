import Foundation
import OmnipolymathChatUI

extension MacGatewayChatTransport {
    func loadAgents(onUpdate: @escaping OmnipolymathChatAgentCatalogUpdate) async throws {
        // The window's first catalog load can precede its event subscription connecting.
        let serverLease = try await self.connection.acquireServerLease()
        try await self.requireCurrentOutboxGateway()
        try await self.loadAgents(ifCurrentServerLease: serverLease, onUpdate: onUpdate)
    }

    private func loadAgents(
        ifCurrentServerLease serverLease: GatewayConnection.ServerLease,
        onUpdate: OmnipolymathChatAgentCatalogUpdate) async throws
    {
        try await OmnipolymathChatAgentsListResponse.load(
            request: self.leasedRequest(serverLease),
            isCurrent: { await self.connection.isCurrentServerLease(serverLease) },
            onUpdate: onUpdate)
    }

    func createSession(
        key: String,
        label: String?,
        agentID: String?,
        parentSessionKey: String?,
        worktree: Bool?,
        worktreeBaseRef: String?) async throws -> OmnipolymathChatCreateSessionResponse
    {
        guard let lease = await self.acquireNewSessionRouteLease() else {
            throw OmnipolymathChatTransportSendError.notDispatched
        }
        return try await lease.createSession(
            key: key,
            label: label,
            agentID: agentID,
            parentSessionKey: parentSessionKey,
            worktree: worktree,
            worktreeBaseRef: worktreeBaseRef)
    }

    func acquireNewSessionRouteLease() async -> OmnipolymathChatNewSessionRouteLease? {
        guard let serverLease = await self.connection.captureServerLease() else { return nil }
        guard await self.currentOutboxGatewayMatchesConnection() else { return nil }
        let request = self.leasedRequest(serverLease)
        return OmnipolymathChatNewSessionRouteLease(
            loadAgents: { onUpdate in
                try await self.loadAgents(ifCurrentServerLease: serverLease, onUpdate: onUpdate)
            },
            createSession: { key, label, explicitAgentID, parentSessionKey, worktree, worktreeBaseRef in
                let agentID = explicitAgentID
                    ?? OmnipolymathChatSessionKey.agentID(from: key)
                    ?? parentSessionKey.flatMap { OmnipolymathChatSessionKey.agentID(from: $0) }
                let createRequest = OmnipolymathChatGatewayRequests.createSession(
                    key: key,
                    agentID: agentID,
                    label: label,
                    parentSessionKey: parentSessionKey,
                    worktree: worktree,
                    worktreeBaseRef: worktreeBaseRef)
                let data = try await request(createRequest)
                return try JSONDecoder().decode(OmnipolymathChatCreateSessionResponse.self, from: data)
            })
    }

    func acquireSessionGroupsRouteLease() async -> OmnipolymathChatSessionGroupsRouteLease? {
        guard let serverLease = await self.connection.captureServerLease() else { return nil }
        guard await self.currentOutboxGatewayMatchesConnection() else { return nil }
        let request = self.leasedRequest(serverLease)
        return OmnipolymathChatSessionGroupsRouteLease(
            listGroups: {
                let data = try await request(OmnipolymathChatGatewayRequests.sessionGroupsList())
                return try JSONDecoder().decode(OmnipolymathChatSessionGroupsResponse.self, from: data)
            },
            putGroups: { names in
                let data = try await request(OmnipolymathChatGatewayRequests.sessionGroupsPut(names: names))
                return try JSONDecoder().decode(OmnipolymathChatSessionGroupsMutationResponse.self, from: data)
            },
            renameGroup: { name, to in
                let data = try await request(OmnipolymathChatGatewayRequests.sessionGroupsRename(name: name, to: to))
                return try JSONDecoder().decode(OmnipolymathChatSessionGroupsMutationResponse.self, from: data)
            },
            deleteGroup: { name in
                let data = try await request(OmnipolymathChatGatewayRequests.sessionGroupsDelete(name: name))
                return try JSONDecoder().decode(OmnipolymathChatSessionGroupsMutationResponse.self, from: data)
            })
    }

    func acquireSessionMutationRouteLease() async -> OmnipolymathChatSessionMutationRouteLease? {
        guard let serverLease = await self.connection.captureServerLease() else { return nil }
        guard await self.currentOutboxGatewayMatchesConnection() else { return nil }
        let unreadAckContract = await self.connection.supportsServerCapability(
            .sessionUnreadAckContract,
            ifCurrentServerLease: serverLease)
        let transport = self
        return OmnipolymathChatSessionMutationRouteLease(
            sessionTarget: { transport.sessionTarget(for: $0) },
            unreadAckContract: unreadAckContract,
            receivesPatchReceipts: true,
            request: self.leasedRequest(serverLease))
    }

    func requestChatSessionAction(_ request: OmnipolymathChatGatewayRequest) async throws -> Data {
        guard let serverLease = await self.connection.captureServerLease() else {
            throw OmnipolymathChatTransportSendError.notDispatched
        }
        try await self.requireCurrentOutboxGateway()
        return try await self.connection.request(
            request,
            ifCurrentServerLease: serverLease)
    }

    private func leasedRequest(
        _ serverLease: GatewayConnection.ServerLease)
        -> @Sendable (OmnipolymathChatGatewayRequest) async throws -> Data
    {
        { request in
            try await self.connection.request(request, ifCurrentServerLease: serverLease)
        }
    }
}
