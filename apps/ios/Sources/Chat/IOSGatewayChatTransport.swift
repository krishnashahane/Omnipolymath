import Foundation
import OmnipolymathChatUI
import OmnipolymathKit
import OmnipolymathProtocol
import OSLog

struct IOSGatewayChatTransport: OmnipolymathChatGatewayTransport {
    var chatGatewayAgentID: String? {
        self.globalAgentId
    }

    func requestChatGateway(_ request: OmnipolymathChatGatewayRequest) async throws -> Data {
        try await self.gateway.request(request)
    }

    static let logger = Logger(subsystem: "ai.omnipolymathfoundation.app", category: "ios.chat.transport")
    let gateway: GatewayNodeSession
    private let widgetGateway: GatewayNodeSession?
    private(set) var globalAgentId: String?
    let outboxGatewayID: String?
    private let mediaArtifactLoader: IOSMediaArtifactLoader?
    private let sourceResourceLoader: IOSSourceResourceLoader?

    var outboxRequiresSessionRoutingContract: Bool {
        true
    }

    func scoped(toAgentID agentID: String) -> (any OmnipolymathChatTransport)? {
        var scoped = self
        scoped.globalAgentId = agentID.trimmedNonEmpty?.lowercased()
        return scoped
    }

    init(
        gateway: GatewayNodeSession,
        widgetGateway: GatewayNodeSession? = nil,
        globalAgentId: String? = nil,
        outboxGatewayID: String? = nil,
        mediaArtifactLoader: IOSMediaArtifactLoader? = nil,
        sourceResourceLoader: IOSSourceResourceLoader? = nil)
    {
        self.gateway = gateway
        self.widgetGateway = widgetGateway
        self.globalAgentId = globalAgentId?.trimmedNonEmpty?.lowercased()
        self.outboxGatewayID = GatewayStableIdentifier.exact(outboxGatewayID)
        self.mediaArtifactLoader = mediaArtifactLoader
        self.sourceResourceLoader = sourceResourceLoader
    }

    func acquireOutboxRouteLease() async -> OmnipolymathChatTransportRouteLeaseResult {
        guard let outboxGatewayID,
              let route = await gateway.currentRoute(ifGatewayID: outboxGatewayID)
        else { return .unavailable(reason: nil) }
        guard let supportsRoutingContract = await gateway.supportsServerCapability(
            .chatSendRoutingContract,
            ifCurrentRoute: route)
        else { return .unavailable(reason: nil) }
        guard supportsRoutingContract else {
            return .unavailable(
                reason: OmnipolymathChatTransportUpgradeMessage.routingContract,
                allowsLiveSend: true)
        }
        let supportsSettingsCAS = await gateway.supportsServerCapability(
            .sessionSettingsCAS,
            ifCurrentRoute: route) == true
        guard let routingContract = try? await self.sessionRoutingContract(ifCurrentRoute: route)
        else { return .unavailable(reason: nil) }
        return .available(OmnipolymathChatTransportRouteLease(
            sendTargetedMessage: { key, target, text, thinking, id, attachments in
                try await self.sendMessage(
                    sessionKey: key,
                    agentID: target.agentID,
                    expectedSessionRoutingContract: routingContract,
                    expectedSessionSettings: target.expectedSessionSettings,
                    queueMode: target.queueMode,
                    message: text,
                    thinking: thinking,
                    idempotencyKey: id,
                    attachments: attachments,
                    ifCurrentRoute: route,
                    distinguishPreDispatchRouteChange: true)
            },
            requestTargetedHistory: { sessionKey, agentID in
                try await self.requestHistory(
                    sessionKey: sessionKey,
                    agentID: agentID,
                    ifCurrentRoute: route)
            },
            sessionRoutingContract: routingContract,
            supportsSessionSettingsCAS: supportsSettingsCAS))
    }

    func acquireSwarmRouteLease() async -> OmnipolymathChatSwarmRouteLease? {
        guard let route = await currentSessionMutationRoute() else { return nil }
        return OmnipolymathChatSwarmRouteLease(
            isEnabled: { sessionKey in
                try await self.isSwarmEnabled(sessionKey: sessionKey, ifCurrentRoute: route)
            },
            listChildSessions: { parentKey in
                try await self.listChildSessions(parentKey: parentKey, ifCurrentRoute: route)
            })
    }

    func acquireSessionSettingsRouteLease() async -> OmnipolymathChatSessionSettingsRouteLease? {
        guard let route = await currentSessionMutationRoute() else { return nil }
        return OmnipolymathChatSessionSettingsRouteLease { sessionKey, agentID, patch in
            try await self.patchSessionSettings(
                sessionKey: sessionKey,
                agentID: agentID,
                patch: patch,
                ifCurrentRoute: route)
        }
    }

    func acquireSessionMutationRouteLease() async -> OmnipolymathChatSessionMutationRouteLease? {
        guard let route = await currentSessionMutationRoute() else { return nil }
        let unreadAckContract = await gateway.supportsServerCapability(
            .sessionUnreadAckContract,
            ifCurrentRoute: route)
        return OmnipolymathChatSessionMutationRouteLease(
            sessionTarget: { self.sessionTarget(for: $0) },
            unreadAckContract: unreadAckContract,
            request: { request in
                try await self.requestSessionMutation(request, ifCurrentRoute: route)
            })
    }

    func acquireNewSessionRouteLease() async -> OmnipolymathChatNewSessionRouteLease? {
        guard let route = await currentSessionMutationRoute() else { return nil }
        let request: @Sendable (OmnipolymathChatGatewayRequest) async throws -> Data = { request in
            try await self.requestSessionMutation(request, ifCurrentRoute: route)
        }
        return OmnipolymathChatNewSessionRouteLease(
            loadAgents: { onUpdate in
                try await OmnipolymathChatAgentsListResponse.load(
                    request: request,
                    isCurrent: { await self.gateway.currentRoute() == route },
                    onUpdate: onUpdate)
            },
            createSession: { key, label, agentID, parentSessionKey, worktree, worktreeBaseRef in
                let createRequest = self.createSessionRequest(
                    key: key,
                    label: label,
                    agentID: agentID,
                    parentSessionKey: parentSessionKey,
                    worktree: worktree,
                    worktreeBaseRef: worktreeBaseRef)
                let data = try await request(createRequest)
                return try JSONDecoder().decode(OmnipolymathChatCreateSessionResponse.self, from: data)
            })
    }

    func currentSessionMutationRoute() async -> GatewayNodeSessionRoute? {
        if let outboxGatewayID {
            return await self.gateway.currentRoute(ifGatewayID: outboxGatewayID)
        }
        return await self.gateway.currentRoute()
    }

    private func sessionRoutingContract(
        ifCurrentRoute route: GatewayNodeSessionRoute) async throws -> String
    {
        let data = try await gateway.request(
            OmnipolymathChatGatewayRequests.agentsList(),
            ifCurrentRoute: route)
        return try OmnipolymathChatGatewayPayloadCodec.decodeSessionRoutingIdentity(data).contract
    }

    typealias SessionTarget = OmnipolymathChatSessionTarget

    static func sessionTarget(
        for rawSessionKey: String,
        selectedAgentID: String?,
        overrideAgentID: String? = nil) -> SessionTarget
    {
        OmnipolymathChatSessionTarget.resolve(
            rawSessionKey,
            selectedAgentID: selectedAgentID,
            overrideAgentID: overrideAgentID,
            policy: .scopeBareKeysToSelectedAgent)
    }

    func sessionTarget(
        for sessionKey: String,
        overrideAgentID: String? = nil) -> SessionTarget
    {
        Self.sessionTarget(
            for: sessionKey,
            selectedAgentID: self.globalAgentId,
            overrideAgentID: overrideAgentID)
    }

    private func requestSessionMutation(
        _ request: OmnipolymathChatGatewayRequest,
        ifCurrentRoute route: GatewayNodeSessionRoute) async throws -> Data
    {
        try await self.gateway.request(
            request,
            ifCurrentRoute: route,
            distinguishPreDispatchRouteChange: true)
    }

    func createSession(
        key: String,
        label: String?,
        agentID: String?,
        parentSessionKey: String?,
        worktree: Bool?,
        worktreeBaseRef: String?) async throws -> OmnipolymathChatCreateSessionResponse
    {
        let request = self.createSessionRequest(
            key: key,
            label: label,
            agentID: agentID,
            parentSessionKey: parentSessionKey,
            worktree: worktree,
            worktreeBaseRef: worktreeBaseRef)
        let res = try await gateway.request(request)
        return try JSONDecoder().decode(OmnipolymathChatCreateSessionResponse.self, from: res)
    }

    private func createSessionRequest(
        key: String,
        label: String?,
        agentID: String?,
        parentSessionKey: String?,
        worktree: Bool?,
        worktreeBaseRef: String?) -> OmnipolymathChatGatewayRequest
    {
        let target = self.sessionTarget(for: key, overrideAgentID: agentID)
        let parentTarget = parentSessionKey.map { self.sessionTarget(for: $0) }
        let explicitAgentID = agentID?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return OmnipolymathChatGatewayRequests.createSession(
            key: target.sessionKey,
            agentID: explicitAgentID?.isEmpty == false
                ? explicitAgentID
                : target.agentID ?? parentTarget?.agentID,
            label: label,
            parentSessionKey: parentTarget?.sessionKey,
            worktree: worktree,
            worktreeBaseRef: worktreeBaseRef)
    }

    func listSessions(
        limit: Int?,
        search: String?,
        archived: Bool) async throws -> OmnipolymathChatSessionsListResponse
    {
        try await self.listSessions(limit: limit, search: search, archived: archived, agentID: self.globalAgentId)
    }

    func listSessions(
        limit: Int?,
        search: String?,
        archived: Bool,
        agentID: String?) async throws -> OmnipolymathChatSessionsListResponse
    {
        let request = OmnipolymathChatGatewayRequests.sessionsList(
            limit: limit,
            search: search,
            archived: archived,
            agentID: agentID)
        let res = try await gateway.request(request)
        return try OmnipolymathChatGatewayPayloadCodec.decodeSessionsList(res, agentID: agentID)
    }

    func listChildSessions(parentKey: String) async throws -> OmnipolymathChatChildSessionsResult {
        try await self.listChildSessions(parentKey: parentKey, ifCurrentRoute: nil)
    }

    private func listChildSessions(
        parentKey: String,
        ifCurrentRoute route: GatewayNodeSessionRoute?) async throws -> OmnipolymathChatChildSessionsResult
    {
        try await OmnipolymathChatChildSessionPager.collect { offset in
            let request = OmnipolymathChatGatewayRequests.sessionsList(
                limit: 10000,
                search: nil,
                archived: false,
                includeGlobal: false,
                spawnedBy: parentKey,
                offset: offset,
                configuredAgentsOnly: true)
            let data = try await gateway.request(request, ifCurrentRoute: route)
            return try JSONDecoder().decode(OmnipolymathChatSessionsListResponse.self, from: data)
        }
    }

    func listModels(agentID: String?) async throws -> [OmnipolymathChatModelChoice] {
        let response = try await gateway.request(OmnipolymathChatGatewayRequests.modelsList(agentID: agentID))
        return try OmnipolymathChatGatewayPayloadCodec.decodeModelChoices(response)
    }

    func acquireModelSignInContext(agentID: String?) async -> OmnipolymathChatModelSignInContext? {
        guard let route = await self.currentSessionMutationRoute(),
              await self.gateway.supportsServerMethod("models.authLogin", ifCurrentRoute: route) == true,
              let agentID = agentID ?? self.globalAgentId
        else { return nil }
        let gateway = self.gateway
        return OmnipolymathChatModelSignInContext(
            agentID: agentID,
            request: { method, params in
                try await gateway.request(
                    OmnipolymathChatGatewayRequest(method: method, params: params, timeoutMs: 26 * 60 * 1000),
                    ifCurrentRoute: route)
            },
            isCurrent: { await gateway.supportsServerMethod("models.authLogin", ifCurrentRoute: route) == true })
    }

    func loadModelCatalog(
        sessionKey: String,
        agentID: String?) async throws -> OmnipolymathChatModelCatalogSnapshot
    {
        guard let route = await self.currentSessionMutationRoute() else {
            throw CancellationError()
        }
        guard await self.gateway.supportsServerCapability(
            .publishedModelCatalog,
            ifCurrentRoute: route) == true
        else {
            return OmnipolymathChatModelCatalogSnapshot(choices: [], availabilityIsSessionScoped: false)
        }
        let request = OmnipolymathChatGatewayRequests.modelsList(
            agentID: agentID ?? self.globalAgentId, sessionKey: sessionKey)
        let response = try await self.gateway.request(request, ifCurrentRoute: route)
        return try OmnipolymathChatGatewayPayloadCodec.decodeModelCatalog(response)
    }

    func isSwarmEnabled(sessionKey: String) async throws -> Bool {
        try await self.isSwarmEnabled(sessionKey: sessionKey, ifCurrentRoute: nil)
    }

    private func isSwarmEnabled(
        sessionKey: String,
        ifCurrentRoute route: GatewayNodeSessionRoute?) async throws -> Bool
    {
        let request = OmnipolymathChatGatewayRequests.chatMetadata(
            sessionKey: sessionKey,
            fallbackAgentID: self.globalAgentId)
        let response = try await gateway.request(request, ifCurrentRoute: route)
        return try JSONDecoder().decode(OmnipolymathChatMetadataCapabilities.self, from: response).swarmEnabled
    }

    func setSessionModel(sessionKey: String, model: String?) async throws {
        _ = try await self.patchSessionModel(sessionKey: sessionKey, agentID: nil, model: model)
    }

    func patchSessionSettings(
        sessionKey: String,
        agentID: String?,
        patch: OmnipolymathChatSessionSettingsPatch) async throws -> OmnipolymathChatModelPatchResult?
    {
        try await self.patchSessionSettings(
            sessionKey: sessionKey,
            agentID: agentID,
            patch: patch,
            ifCurrentRoute: nil)
    }

    private func patchSessionSettings(
        sessionKey: String,
        agentID: String?,
        patch: OmnipolymathChatSessionSettingsPatch,
        ifCurrentRoute expectedRoute: GatewayNodeSessionRoute?) async throws -> OmnipolymathChatModelPatchResult?
    {
        let fallbackRoute: GatewayNodeSessionRoute? = if patch.requiresSessionSettingsContract, expectedRoute == nil {
            await self.currentSessionMutationRoute()
        } else {
            nil
        }
        let settingsRoute = expectedRoute ?? fallbackRoute
        let settingsSupport = if let settingsRoute {
            await sessionSettingsSupport(ifCurrentRoute: settingsRoute)
        } else {
            (settingsContract: false, settingsCAS: false)
        }
        let target = self.sessionTarget(for: sessionKey, overrideAgentID: agentID)
        let request = try OmnipolymathChatGatewayRequests.patchSessionSettings(
            sessionKey: target.sessionKey,
            agentID: target.agentID,
            patch: patch,
            supportsSessionSettingsContract: settingsSupport.settingsContract,
            supportsSessionSettingsCAS: settingsSupport.settingsCAS)
        let response = if let settingsRoute {
            try await self.gateway.request(
                request,
                ifCurrentRoute: settingsRoute,
                distinguishPreDispatchRouteChange: true)
        } else {
            try await self.gateway.request(request)
        }
        return try Self.decodeModelPatchResult(response)
    }

    static func decodeModelPatchResult(_ data: Data) throws -> OmnipolymathChatModelPatchResult {
        try JSONDecoder().decode(OmnipolymathChatModelPatchResult.self, from: data)
    }

    func patchSession(
        key: String,
        expectedSessionID: String? = nil,
        label: String?? = nil,
        category: String?? = nil,
        color: String?? = nil,
        pinned: Bool? = nil,
        archived: Bool? = nil,
        unread: Bool? = nil) async throws
    {
        guard let routeLease = await acquireSessionMutationRouteLease() else {
            throw OmnipolymathChatTransportSendError.notDispatched
        }
        try await routeLease.patchSession(
            key: key,
            expectedSessionID: expectedSessionID,
            label: label,
            category: category,
            color: color,
            pinned: pinned,
            archived: archived,
            unread: unread)
    }

    func forkSession(parentKey: String, fromLastCompleted: Bool, agentID: String?) async throws -> String {
        let target = self.sessionTarget(for: parentKey, overrideAgentID: agentID)
        let childAgentID = target.agentID ?? OmnipolymathChatSessionKey.agentID(from: target.sessionKey)
        let request = OmnipolymathChatGatewayRequests.forkSession(
            parentSessionKey: target.sessionKey,
            agentID: childAgentID,
            fromLastCompleted: fromLastCompleted)
        let response = try await gateway.request(request)
        return try JSONDecoder().decode(OmnipolymathChatCreateSessionResponse.self, from: response).key
    }

    func compactSession(sessionKey: String) async throws {
        let target = self.sessionTarget(for: sessionKey)
        let request = OmnipolymathChatGatewayRequests.compactSession(
            sessionKey: target.sessionKey,
            agentID: target.agentID)
        let response = try await gateway.request(request)
        try OmnipolymathSessionsCompactResponse.requireSuccess(from: response)
    }

    func requestHistory(sessionKey: String) async throws -> OmnipolymathChatHistoryPayload {
        try await self.requestHistory(sessionKey: sessionKey, agentID: nil, ifCurrentRoute: nil)
    }

    func requestHistory(sessionKey: String, cursor: String) async throws -> OmnipolymathChatHistoryPayload {
        guard let route = await self.gateway.currentRoute() else { throw CancellationError() }
        let target = self.sessionTarget(for: sessionKey)
        let request = OmnipolymathChatGatewayRequests.history(
            sessionKey: target.sessionKey, agentID: target.agentID, cursor: cursor, maxBytes: 256 * 1024)
        let data = try await self.gateway.request(request, ifCurrentRoute: route)
        guard await self.gateway.currentRoute() == route else { throw CancellationError() }
        return try JSONDecoder().decode(OmnipolymathChatHistoryPayload.self, from: data)
    }

    func gatewayAdvertisesMethod(_ method: String) async -> Bool? {
        guard let route = await currentSessionMutationRoute() else { return nil }
        return await self.gateway.supportsServerMethod(method, ifCurrentRoute: route)
    }

    func attachmentLimits() async -> GatewayAttachmentLimits? {
        guard let route = await self.currentSessionMutationRoute() else { return nil }
        return await self.gateway.currentAttachmentLimits(ifCurrentRoute: route)
    }

    func fetchProgressCard(sessionKey: String, agentID: String?) async throws -> ProgressCard? {
        let target = self.sessionTarget(for: sessionKey, overrideAgentID: agentID)
        let data = try await self.progressCardRequest(OmnipolymathChatGatewayRequests.progressCardGet(
            sessionKey: target.sessionKey,
            agentID: target.agentID))
        return try OmnipolymathChatGatewayPayloadCodec.decodeProgressCard(
            data,
            agentID: OmnipolymathChatSessionKey.agentID(from: target.sessionKey) ?? target.agentID)
    }

    func clearProgressCard(sessionKey: String, agentID: String?, expectedRevision: Int) async throws {
        let target = self.sessionTarget(for: sessionKey, overrideAgentID: agentID)
        _ = try await self.progressCardRequest(OmnipolymathChatGatewayRequests.progressCardClear(
            sessionKey: target.sessionKey,
            agentID: target.agentID,
            expectedRevision: expectedRevision))
    }

    func refreshProgressCard(
        sessionKey: String,
        agentID: String?,
        idempotencyKey: String) async throws -> OmnipolymathChatProgressCardRefreshResult
    {
        let target = self.sessionTarget(for: sessionKey, overrideAgentID: agentID)
        let data = try await self.progressCardRequest(OmnipolymathChatGatewayRequests.progressCardRefresh(
            sessionKey: target.sessionKey,
            agentID: target.agentID,
            idempotencyKey: idempotencyKey))
        return try OmnipolymathChatGatewayPayloadCodec.decodeProgressCardRefresh(data)
    }

    private func progressCardRequest(_ request: OmnipolymathChatGatewayRequest) async throws -> Data {
        guard let route = await self.currentSessionMutationRoute() else { throw CancellationError() }
        if request.params["agentId"] != nil {
            guard let supported = await self.gateway.supportsServerCapability(
                .progressCardAgentScope,
                ifCurrentRoute: route) else { throw CancellationError() }
            guard supported else {
                throw OmnipolymathChatProgressCardError.ownerScopeUnavailable
            }
        }
        return try await self.gateway.request(request, ifCurrentRoute: route)
    }

    func acquireReactionsRouteLease() async -> OmnipolymathChatReactionsRouteLease? {
        guard let route = await self.currentSessionMutationRoute(),
              let facts = await self.gateway.currentReactionAccess(ifCurrentRoute: route)
        else { return nil }
        return self.reactionsRouteLease(
            routeID: facts.routeID,
            access: OmnipolymathChatReactionAccess(
                role: facts.role,
                scopes: facts.scopes,
                sessionCap: facts.sessionCap,
                methods: facts.methods,
                userID: facts.userID),
            isCurrent: { await self.gateway.currentRoute() == route },
            request: { request in
                try await self.gateway.request(request, ifCurrentRoute: route)
            })
    }

    func resolveInlineWidgetResource(
        path: String,
        replacing failedResource: OmnipolymathChatWidgetResource?) async -> OmnipolymathChatWidgetResource?
    {
        let gateway = self.gateway
        let widgetGateway = self.widgetGateway
        return await OmnipolymathChatWidgetURLResolver.resolveResource(
            target: path,
            replacing: failedResource,
            currentSurfaceRoutes: {
                let node = await widgetGateway?.currentCanvasHostRoute()
                let operatorSurface = await gateway.currentCanvasHostRoute()
                return (node: node, operatorSurface: operatorSurface)
            },
            // Prefer the device's node route; operator rotation covers clients
            // whose node role is unavailable or intentionally disabled.
            refreshNodeSurfaceRoute: { observed in
                await widgetGateway?.refreshCanvasHostRoute(replacing: observed?.url)
            },
            refreshOperatorSurfaceRoute: { observed in
                await gateway.refreshCanvasHostRoute(replacing: observed?.url)
            })
    }

    func loadSourceContext() async -> OmnipolymathChatSourceContext? {
        guard let route = await currentSessionMutationRoute() else { return nil }
        return await self.sourceResourceLoader?.loadContext(ifCurrentRoute: route)
    }

    func loadSourceFavicon(host: String) async -> Data? {
        guard let route = await currentSessionMutationRoute() else { return nil }
        return await self.sourceResourceLoader?.loadFavicon(host: host, ifCurrentRoute: route)
    }

    func loadMediaArtifact(
        sessionKey: String,
        artifactId: String,
        kind: OmnipolymathChatMediaKind,
        playback: OmnipolymathChatPlaybackMode?) async throws -> OmnipolymathChatLoadedMedia?
    {
        guard kind.acceptsManagedArtifactID(artifactId),
              let mediaArtifactLoader,
              let route = await gateway.currentRoute(),
              let gatewayID = await gateway.currentGatewayID(ifCurrentRoute: route)
        else { return nil }
        let target = self.sessionTarget(for: sessionKey)
        let request = OmnipolymathChatGatewayRequests.artifactDownload(
            sessionKey: target.sessionKey,
            agentID: target.agentID,
            artifactId: artifactId)
        let data = try await gateway.request(request, ifCurrentRoute: route)
        let response = try JSONDecoder().decode(ArtifactsDownloadResult.self, from: data)
        guard await self.gateway.currentRoute() == route else { throw CancellationError() }
        let loaded = try await mediaArtifactLoader.load(
            response: response,
            kind: kind,
            playback: playback,
            expectedGatewayID: gatewayID)
        guard await self.gateway.currentRoute() == route else { throw CancellationError() }
        return loaded
    }

    func resolveInlineWidgetURL(path: String, replacing failedURL: URL?) async -> URL? {
        await self.resolveInlineWidgetResource(
            path: path,
            replacing: failedURL.map { OmnipolymathChatWidgetResource(url: $0) })?.url
    }

    func requestHistory(
        sessionKey: String,
        agentID: String? = nil,
        inputRunIDs: [String]? = nil,
        ifCurrentRoute expectedRoute: GatewayNodeSessionRoute?) async throws -> OmnipolymathChatHistoryPayload
    {
        let target = self.sessionTarget(for: sessionKey, overrideAgentID: agentID)
        let request = OmnipolymathChatGatewayRequests.history(
            sessionKey: target.sessionKey,
            agentID: target.agentID,
            inputRunIDs: inputRunIDs)
        let res = try await gateway.request(
            request,
            ifCurrentRoute: expectedRoute)
        return try JSONDecoder().decode(OmnipolymathChatHistoryPayload.self, from: res)
    }

    static func isUnsupportedHistoryInputRunIDsError(_ error: any Error) -> Bool {
        // Gateways through v2026.8.1 reject this optional field without a capability bit.
        // Remove this wire-contract fallback once the minimum Gateway is v2026.8.2;
        // local doctor cannot upgrade a remote Gateway.
        guard let error = error as? GatewayResponseError,
              error.method == "chat.history",
              error.code == "INVALID_REQUEST"
        else { return false }
        return error.message == "invalid chat.history params: at root: unexpected property 'inputRunIds'"
    }

    func waitForRunCompletion(
        runId rawRunId: String,
        timeoutMs: Int) async -> OmnipolymathChatRunObservation
    {
        let route = await gateway.currentRoute()
        return await self.waitForRunCompletion(
            runId: rawRunId,
            timeoutMs: timeoutMs,
            ifCurrentRoute: route)
    }

    func waitForRunCompletion(
        runId rawRunId: String,
        timeoutMs: Int,
        ifCurrentRoute expectedRoute: GatewayNodeSessionRoute?) async -> OmnipolymathChatRunObservation
    {
        let runId = rawRunId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !runId.isEmpty, let expectedRoute else { return .unavailable }

        do {
            let request = OmnipolymathChatGatewayRequests.agentWait(runID: runId, timeoutMs: timeoutMs)
            let res = try await gateway.request(
                request,
                ifCurrentRoute: expectedRoute)
            return try OmnipolymathChatGatewayPayloadCodec.decodeAgentWaitObservation(res)
        } catch {
            Self.logger.warning("agent.wait failed \(error.localizedDescription, privacy: .public)")
            GatewayDiagnostics.log("agent.wait failed runId=\(runId) error=\(error.localizedDescription)")
            return .unavailable
        }
    }

    func requestHealth(timeoutMs: Int) async throws -> Bool {
        // Health probes must not spend their request budget waiting for a reconnect.
        // The session owns reconnects; a later probe can use its new live route.
        guard let route = await gateway.currentRoute() else { throw CancellationError() }
        let res = try await gateway.request(
            OmnipolymathChatGatewayRequests.health(timeoutMs: timeoutMs),
            ifCurrentRoute: route)
        return (try? JSONDecoder().decode(OmnipolymathGatewayHealthOK.self, from: res))?.ok ?? true
    }

    func events() -> AsyncStream<OmnipolymathChatTransportEvent> {
        AsyncStream { continuation in
            let task = Task {
                let stream = await self.gateway.subscribeServerEvents()
                for await evt in stream {
                    if Task.isCancelled {
                        return
                    }
                    if let mapped = OmnipolymathChatGatewayPayloadCodec.event(from: evt) {
                        switch mapped {
                        case .chatMetadataChanged, .modelSelectionChanged, .seqGap, .routeChanged:
                            await self.sourceResourceLoader?.invalidate()
                        default:
                            break
                        }
                        continuation.yield(mapped)
                    }
                }
            }

            continuation.onTermination = { @Sendable _ in
                task.cancel()
            }
        }
    }
}
