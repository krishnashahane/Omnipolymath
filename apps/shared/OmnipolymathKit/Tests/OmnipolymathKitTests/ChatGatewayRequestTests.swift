import Foundation
import OmnipolymathKit
import OmnipolymathProtocol
import Testing
@testable import OmnipolymathChatUI

struct ChatGatewayRequestTests {
    @Test(arguments: [
        ("global", "research", "global", Optional("research")),
        ("agent:research:global", "research", "agent:research:global", nil),
        ("main", "research", "agent:research:main", nil),
        ("agent:research:workbench", "research", "agent:research:workbench", nil),
    ])
    func `progress requests retain raw global owner and preserve old qualified schema`(
        key: String,
        owner: String,
        expectedKey: String,
        expectedOwner: String?)
    {
        let request = OmnipolymathChatGatewayRequests.progressCardGet(sessionKey: key, agentID: owner)
        #expect(request.method == "progressCard.get")
        #expect(request.params["sessionKey"]?.value as? String == expectedKey)
        #expect(request.params["agentId"]?.value as? String == expectedOwner)
        #expect(Set(request.params.keys) == (expectedOwner == nil ? ["sessionKey"] : ["sessionKey", "agentId"]))
    }

    @Test func `clearing and refreshing a progress card send the target and one extra field`() {
        let clear = OmnipolymathChatGatewayRequests.progressCardClear(
            sessionKey: "agent:main:main",
            agentID: "main",
            expectedRevision: 7)
        #expect(clear.method == "progressCard.put")
        #expect(clear.params["expectedRevision"]?.value as? Int == 7)
        #expect(Set(clear.params.keys) == ["sessionKey", "expectedRevision"])

        let refresh = OmnipolymathChatGatewayRequests.progressCardRefresh(
            sessionKey: "agent:main:main",
            agentID: "main",
            idempotencyKey: "tap-1")
        #expect(refresh.method == "progressCard.refresh")
        #expect(refresh.params["idempotencyKey"]?.value as? String == "tap-1")
        #expect(Set(refresh.params.keys) == ["sessionKey", "idempotencyKey"])
    }

    @Test func `progress payloads validate the captured agent without replacing null`() throws {
        let valid = Data(
            #"{"card":{"sessionKey":"agent:research:global","revision":1,"updatedAt":10,"markdown":"Research","steps":[]}}"#
                .utf8)
        #expect(try OmnipolymathChatGatewayPayloadCodec.decodeProgressCard(valid, agentID: "research")?
            .markdown == "Research")
        #expect(throws: (any Error).self) {
            try OmnipolymathChatGatewayPayloadCodec.decodeProgressCard(valid, agentID: "main")
        }
        #expect(try OmnipolymathChatGatewayPayloadCodec.decodeProgressCard(
            Data(#"{"card":null}"#.utf8), agentID: "research") == nil)
    }

    @Test(arguments: [[String]?.none, [], ["api.example.test"]])
    func `question host consent uses protocol field`(hosts: [String]?) throws {
        let request = OmnipolymathChatGatewayRequests.resolveQuestion(
            id: "ask_secret", answers: ["credential": ["  synthetic-value  "]], secretStoreAllowedHosts: hosts)
        let data = try JSONEncoder().encode(request.params)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object["secretStoreAllowedHosts"] as? [String] == hosts)
        let envelope = try #require(object["answers"] as? [String: [String: [String]]])
        #expect(envelope == ["answers": ["credential": ["  synthetic-value  "]]])
    }

    @Test func `question answer response decodes canonical marker`() throws {
        let data = Data(#"{"status":"answered","answers":{"answers":{"credential":["stored"]}}}"#.utf8)
        let answers = try OmnipolymathChatGatewayPayloadCodec.decodeQuestionAnswer(data)
        let encoded = try JSONEncoder().encode(answers)
        let object = try JSONSerialization.jsonObject(with: encoded) as? [String: [String: [String]]]
        #expect(object == ["answers": ["credential": ["stored"]]])
        for invalid in [
            #"{"status":"cancelled"}"#,
            #"{"status":"pending","answers":{"answers":{}}}"#,
            #"{"status":"answered"}"#,
        ] {
            #expect(throws: (any Error).self) {
                try OmnipolymathChatGatewayPayloadCodec.decodeQuestionAnswer(Data(invalid.utf8))
            }
        }
    }

    @Test(arguments: [[String]?.none, [], ["watch-run", "queued-source"]])
    func `history requests consumption only for supplied input runs`(inputRunIDs: [String]?) {
        let request = OmnipolymathChatGatewayRequests.history(
            sessionKey: "global",
            agentID: "reviewer",
            inputRunIDs: inputRunIDs)

        #expect(request.method == "chat.history")
        #expect(request.params["sessionKey"]?.value as? String == "global")
        #expect(request.params["agentId"]?.value as? String == "reviewer")
        #expect(request.params["inputRunIds"]?.value as? [String] ==
            (inputRunIDs?.isEmpty == false ? inputRunIDs : nil))
    }

    @Test func `models list scopes worker catalogs and preserves default scope`() {
        let worker = OmnipolymathChatGatewayRequests.modelsList(agentID: " worker ")
        let defaultAgent = OmnipolymathChatGatewayRequests.modelsList(agentID: nil)

        #expect(worker.method == "models.list")
        #expect(worker.params["agentId"]?.value as? String == "worker")
        #expect(defaultAgent.params.isEmpty)
    }

    @Test func `session observation requests encode global subscription and actual visibility`() {
        let subscribe = OmnipolymathChatGatewayRequests.subscribeSessions()
        let visible = OmnipolymathChatGatewayRequests.setSessionObserverVisibility(true)
        let hidden = OmnipolymathChatGatewayRequests.setSessionObserverVisibility(false)
        let longerSubscription = OmnipolymathChatGatewayRequests.subscribeSessions(timeoutMs: 12000)
        let longerVisibility = OmnipolymathChatGatewayRequests.setSessionObserverVisibility(
            true,
            timeoutMs: 12000)

        #expect(subscribe.method == "sessions.subscribe")
        #expect(subscribe.params.isEmpty)
        #expect(subscribe.timeoutMs == 10000)
        #expect(visible.method == "sessions.observer.visibility")
        #expect(visible.params["visible"]?.value as? Bool == true)
        #expect(visible.timeoutMs == 10000)
        #expect(hidden.method == "sessions.observer.visibility")
        #expect(hidden.params["visible"]?.value as? Bool == false)
        #expect(hidden.timeoutMs == 10000)
        #expect(longerSubscription.timeoutMs == 12000)
        #expect(longerVisibility.timeoutMs == 12000)
    }

    @Test func `session targets share normalization while preserving platform routing policy`() {
        #expect(OmnipolymathChatSessionTarget.resolve(
            " Matrix:Channel:Room ",
            selectedAgentID: " Reviewer ",
            policy: .scopeBareKeysToSelectedAgent) == .init(
            sessionKey: "agent:reviewer:Matrix:Channel:Room",
            agentID: nil))
        #expect(OmnipolymathChatSessionTarget.resolve(
            " main ",
            selectedAgentID: " Reviewer ",
            policy: .preserveBareKeys) == .init(sessionKey: "main", agentID: nil))
        #expect(OmnipolymathChatSessionTarget.resolve(
            " GLOBAL ",
            selectedAgentID: " Reviewer ",
            policy: .preserveBareKeys) == .init(sessionKey: "GLOBAL", agentID: "reviewer"))
        #expect(OmnipolymathChatSessionTarget.resolve(
            "agent:ops:main",
            selectedAgentID: "reviewer",
            policy: .scopeBareKeysToSelectedAgent) == .init(
            sessionKey: "agent:ops:main",
            agentID: nil))
        #expect(OmnipolymathChatSessionTarget.resolve(
            "agent::main",
            selectedAgentID: "reviewer",
            policy: .scopeBareKeysToSelectedAgent) == .init(
            sessionKey: "agent::main",
            agentID: nil))
    }

    @Test func `list sessions request normalizes optional filters`() {
        let request = OmnipolymathChatGatewayRequests.sessionsList(
            limit: 12,
            search: "  incident  ",
            archived: true,
            agentID: " Reviewer ")

        #expect(request.method == "sessions.list")
        #expect(request.timeoutMs == 15000)
        #expect(request.params["includeGlobal"]?.value as? Bool == true)
        #expect(request.params["includeUnknown"]?.value as? Bool == false)
        #expect(request.params["limit"]?.value as? Int == 12)
        #expect(request.params["search"]?.value as? String == "incident")
        #expect(request.params["archived"]?.value as? Bool == true)
        #expect(request.params["agentId"]?.value as? String == "Reviewer")

        let unscoped = OmnipolymathChatGatewayRequests.sessionsList(
            limit: nil,
            search: nil,
            archived: false,
            agentID: "   ")
        #expect(unscoped.params["agentId"] == nil)
    }

    @Test func `child session request encodes focused pagination filters`() {
        let request = OmnipolymathChatGatewayRequests.sessionsList(
            limit: 10000,
            search: nil,
            archived: false,
            includeGlobal: false,
            spawnedBy: " agent:main:parent ",
            offset: 10000,
            configuredAgentsOnly: true)

        #expect(request.params["includeGlobal"]?.value as? Bool == false)
        #expect(request.params["spawnedBy"]?.value as? String == "agent:main:parent")
        #expect(request.params["offset"]?.value as? Int == 10000)
        #expect(request.params["configuredAgentsOnly"]?.value as? Bool == true)
    }

    @Test(arguments: [
        (OmnipolymathChatSidebarStatus.active, "{}"),
        (OmnipolymathChatSidebarStatus.archived, #"{"archived":true}"#),
        (OmnipolymathChatSidebarStatus.all, #"{"archived":"all"}"#),
    ])
    func `sidebar list serializes page search and explicit status scope`(
        status: OmnipolymathChatSidebarStatus,
        archiveJSON: String) throws
    {
        let request = OmnipolymathChatGatewayRequests.sidebarSessions(
            query: .init(
                agentID: " research ", status: status, search: " migration ",
                ownerId: " person ", involvingMe: false),
            limit: 200,
            offset: 200)
        let expectedJSON = #"""
        {"includeGlobal":true,"includeUnknown":true,"configuredAgentsOnly":true,
         "limit":200,"offset":200,"agentId":"research","search":"migration","ownerId":"person",
         "excludeCron":true,"excludeSystem":true}
        """#
        var expected = try JSONDecoder().decode(
            [String: OmnipolymathProtocol.AnyCodable].self,
            from: Data(expectedJSON.utf8))
        try expected.merge(
            JSONDecoder().decode([String: OmnipolymathProtocol.AnyCodable].self, from: Data(archiveJSON.utf8)),
            uniquingKeysWith: { _, next in next })
        let wire = try JSONDecoder().decode(
            [String: OmnipolymathProtocol.AnyCodable].self,
            from: JSONEncoder().encode(request.params))
        #expect(request.method == "sessions.list")
        #expect(wire == expected)
    }

    @Test func `unscoped sidebar page does not invent an agent or exclude unknown sessions`() throws {
        let request = OmnipolymathChatGatewayRequests.sidebarSessions(
            query: .init(agentID: nil, status: .all, search: "  "), limit: 100)
        let expectedJSON = #"""
        {"includeGlobal":true,"includeUnknown":true,"configuredAgentsOnly":true,
         "includeDerivedTitles":true,"includeLastMessage":true,"limit":100,"archived":"all"}
        """#
        let wire = try JSONDecoder().decode(
            [String: OmnipolymathProtocol.AnyCodable].self,
            from: JSONEncoder().encode(request.params))
        #expect(try wire == JSONDecoder().decode(
            [String: OmnipolymathProtocol.AnyCodable].self,
            from: Data(expectedJSON.utf8)))
    }

    @Test(arguments: [" research ", nil] as [String?])
    func `sidebar transcript search serializes the corpus scope without metadata search or enrichment`(
        agentID: String?) throws
    {
        let request = OmnipolymathChatGatewayRequests.sidebarTranscriptSearch(
            query: .init(
                agentID: agentID, status: .archived, search: " transcript-only phrase ",
                ownerId: "other-person", involvingMe: true))
        let expectedJSON = #"""
        {"includeGlobal":true,"includeUnknown":true,"configuredAgentsOnly":true,
         "archived":true,"involvingMe":true,"excludeCron":true,"excludeSystem":true}
        """#
        var scope = try JSONDecoder().decode([String: OmnipolymathProtocol.AnyCodable].self, from: Data(expectedJSON.utf8))
        if agentID != nil { scope["agentId"] = OmnipolymathProtocol.AnyCodable("research") }
        let wire = try JSONDecoder().decode(
            [String: OmnipolymathProtocol.AnyCodable].self,
            from: JSONEncoder().encode(request.params))
        #expect(request.method == "sessions.search")
        #expect(wire == [
            "query": OmnipolymathProtocol.AnyCodable("transcript-only phrase"),
            "limit": OmnipolymathProtocol.AnyCodable(25),
            "scope": OmnipolymathProtocol.AnyCodable(scope),
        ])
    }

    @Test func `session patch request preserves explicit null clearing`() {
        let request = OmnipolymathChatGatewayRequests.patchSession(
            sessionKey: "global",
            agentID: "reviewer",
            label: .some(nil),
            category: .some(nil),
            color: .some(nil),
            pinned: true,
            archived: nil,
            unreadPatch: nil)

        #expect(request.method == "sessions.patch")
        #expect(request.params["key"]?.value as? String == "global")
        #expect(request.params["agentId"]?.value as? String == "reviewer")
        #expect(request.params["label"]?.value is NSNull)
        #expect(request.params["category"]?.value is NSNull)
        #expect(request.params["color"]?.value is NSNull)
        #expect(request.params["pinned"]?.value as? Bool == true)
        #expect(request.params["archived"] == nil)
    }

    @Test(arguments: ["blue", nil] as [String?])
    func `session color patch sets names without changing unrelated fields`(color: String?) throws {
        let request = OmnipolymathChatGatewayRequests.patchSession(
            sessionKey: "agent:main:work",
            agentID: "main",
            label: nil,
            category: nil,
            color: color.map { .some($0) },
            pinned: nil,
            archived: nil,
            unreadPatch: nil)
        let data = try JSONEncoder().encode(request.params)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object["color"] as? String == color)
        #expect(object.count == (color == nil ? 2 : 3))
    }

    @Test func `session read acknowledgement encodes an absent manual marker as null`() {
        let request = OmnipolymathChatGatewayRequests.patchSession(
            sessionKey: "main",
            agentID: nil,
            label: nil,
            category: nil,
            pinned: nil,
            archived: nil,
            unreadPatch: .automaticRead(expectedMarkedUnreadAt: nil))

        #expect(request.params["expectedMarkedUnreadAt"]?.value is NSNull)
    }

    @Test func `explicit session read uses the legacy-compatible payload`() {
        let request = OmnipolymathChatGatewayRequests.patchSession(
            sessionKey: "main",
            agentID: nil,
            label: nil,
            category: nil,
            pinned: nil,
            archived: nil,
            unreadPatch: .read)

        #expect(request.params["unread"]?.value as? Bool == false)
        #expect(request.params["readIntent"] == nil)
        #expect(request.params["expectedMarkedUnreadAt"] == nil)
    }

    @Test func `session read routing separates explicit automatic and legacy requests`() {
        #expect(OmnipolymathChatSessionUnreadPatch.routed(
            unread: false,
            expectedMarkedUnreadAt: nil,
            supportsReadContract: true) == .read)
        #expect(OmnipolymathChatSessionUnreadPatch.routed(
            unread: false,
            expectedMarkedUnreadAt: .some(nil),
            supportsReadContract: true) == .automaticRead(expectedMarkedUnreadAt: nil))
        #expect(OmnipolymathChatSessionUnreadPatch.routed(
            unread: false,
            expectedMarkedUnreadAt: .some(10),
            supportsReadContract: false) == .read)
    }

    @Test func `settings patch request encodes default model as null`() {
        let request = OmnipolymathChatGatewayRequests.patchSessionSettings(
            sessionKey: "agent:main:main",
            agentID: nil,
            model: .some(nil))

        #expect(request.params["model"]?.value is NSNull)
        #expect(request.params["agentId"] == nil)
    }

    @Test func `settings patch request encodes model thinking and verbosity atomically`() {
        let request = OmnipolymathChatGatewayRequests.patchSessionSettings(
            sessionKey: "global",
            agentID: "reviewer",
            model: .some("openai/gpt-5.6-luna"),
            thinkingLevel: .some("ultra"),
            verboseLevel: .some("full"))

        #expect(request.method == "sessions.patch")
        #expect(request.params["key"]?.value as? String == "global")
        #expect(request.params["agentId"]?.value as? String == "reviewer")
        #expect(request.params["model"]?.value as? String == "openai/gpt-5.6-luna")
        #expect(request.params["thinkingLevel"]?.value as? String == "ultra")
        #expect(request.params["verboseLevel"]?.value as? String == "full")
    }

    @Test func `settings patch request encodes fast values and explicit resets`() throws {
        let reset = OmnipolymathChatGatewayRequests.patchSessionSettings(
            sessionKey: "main",
            agentID: nil,
            thinkingLevel: .some(nil),
            fastMode: .some(nil),
            verboseLevel: .some(nil))
        let automatic = OmnipolymathChatGatewayRequests.patchSessionSettings(
            sessionKey: "main",
            agentID: nil,
            fastMode: .some(.automatic))

        #expect(reset.params["thinkingLevel"]?.value is NSNull)
        #expect(reset.params["fastMode"]?.value is NSNull)
        #expect(reset.params["verboseLevel"]?.value is NSNull)
        #expect(automatic.params["fastMode"]?.value as? String == "auto")
        let ultrafast = try JSONDecoder().decode(OmnipolymathChatFastMode.self, from: Data(#""ultrafast""#.utf8))
        #expect(ultrafast == .ultrafast)
        #expect(ultrafast.isEnabled)
        #expect(try JSONEncoder().encode(ultrafast) == Data(#""ultrafast""#.utf8))
        let request = OmnipolymathChatGatewayRequests.patchSessionSettings(
            sessionKey: "main", agentID: nil, fastMode: .some(ultrafast))
        #expect(request.params["fastMode"]?.value as? String == "ultrafast")
    }

    @Test func `settings patch builder maps every field including sparse overrides and resets`() throws {
        let overrides = OmnipolymathChatSessionToolOverrides(
            webSearch: false,
            skills: ["release": false],
            mcpServers: ["github": true],
            mcpToolsDeny: ["github": ["create_issue", "delete_issue"]])
        let request = try OmnipolymathChatGatewayRequests.patchSessionSettings(
            sessionKey: "global",
            agentID: "reviewer",
            patch: .init(
                expectedSessionID: "sess-global",
                expectedPermissionMode: .some(.guarded),
                expectedToolOverrides: .some(.init(webSearch: false)),
                model: .some("example/model"),
                thinkingLevel: .some("high"),
                fastMode: .some(.automatic),
                verboseLevel: .some("full"),
                permissionMode: .some(.workspace),
                toolOverrides: .some(overrides)),
            supportsSessionSettingsContract: true,
            supportsSessionSettingsCAS: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let expected: [String: Any] = [
            "key": "global", "agentId": "reviewer", "expectedSessionId": "sess-global",
            "expectedPermissionMode": "guarded", "expectedToolOverrides": ["webSearch": false],
            "model": "example/model", "thinkingLevel": "high", "fastMode": "auto", "verboseLevel": "full",
            "permissionMode": "workspace",
            "toolOverrides": [
                "webSearch": false, "skills": ["release": false], "mcpServers": ["github": true],
                "mcpToolsDeny": ["github": ["create_issue", "delete_issue"]],
            ],
        ]
        #expect(request.method == "sessions.patch")
        #expect(request.timeoutMs == 15000)
        #expect(try encoder.encode(request.params) == JSONSerialization.data(
            withJSONObject: expected, options: .sortedKeys))

        let reset = try OmnipolymathChatGatewayRequests.patchSessionSettings(
            sessionKey: "global",
            agentID: "reviewer",
            patch: .init(
                expectedPermissionMode: .some(nil), expectedToolOverrides: .some(nil),
                model: .some(nil), thinkingLevel: .some(nil), fastMode: .some(nil), verboseLevel: .some(nil),
                permissionMode: .some(nil), toolOverrides: .some(nil)),
            supportsSessionSettingsContract: true,
            supportsSessionSettingsCAS: true)
        let cleared: [String: Any] = [
            "key": "global", "agentId": "reviewer", "expectedPermissionMode": NSNull(),
            "expectedToolOverrides": NSNull(), "model": NSNull(), "thinkingLevel": NSNull(),
            "fastMode": NSNull(), "verboseLevel": NSNull(), "permissionMode": NSNull(), "toolOverrides": NSNull(),
        ]
        #expect(try encoder.encode(reset.params) == JSONSerialization.data(
            withJSONObject: cleared, options: .sortedKeys))
    }

    @Test(arguments: [false, true], [false, true])
    func `settings patch builder gates contract and CAS independently`(contract: Bool, cas: Bool) throws {
        let cases: [(patch: OmnipolymathChatSessionSettingsPatch, contract: Bool, cas: Bool)] = [
            (.init(model: .some("example/model")), false, false),
            (.init(expectedSessionID: "sess-global", model: .some("example/model")), true, false),
            (.init(expectedPermissionMode: .some(nil)), false, true),
            (.init(expectedToolOverrides: .some(nil)), false, true),
            (.init(permissionMode: .some(nil)), true, true),
            (.init(toolOverrides: .some(nil)), true, true),
        ]
        for item in cases {
            if (item.contract && !contract) || (item.cas && !cas) {
                #expect(throws: OmnipolymathChatTransportSendError.notDispatched) {
                    try OmnipolymathChatGatewayRequests.patchSessionSettings(
                        sessionKey: "global", agentID: nil, patch: item.patch,
                        supportsSessionSettingsContract: contract, supportsSessionSettingsCAS: cas)
                }
            } else {
                let request = try OmnipolymathChatGatewayRequests.patchSessionSettings(
                    sessionKey: "global", agentID: nil, patch: item.patch,
                    supportsSessionSettingsContract: contract, supportsSessionSettingsCAS: cas)
                #expect(request.params["key"]?.value as? String == "global")
                #expect(request.params.count == (item.patch.expectedSessionID == nil ? 2 : 3))
            }
        }
    }

    @Test func `composer catalog requests preserve their owner scope`() {
        let skills = OmnipolymathChatGatewayRequests.composerSkillsStatus(agentID: "reviewer")
        let config = OmnipolymathChatGatewayRequests.composerConfigGet()
        let tools = OmnipolymathChatGatewayRequests.composerToolsEffective(
            sessionKey: "agent:reviewer:main",
            agentID: "reviewer")

        #expect(skills.method == "skills.status")
        #expect(skills.params["agentId"]?.value as? String == "reviewer")
        #expect(config.method == "config.get")
        #expect(config.params.isEmpty)
        #expect(tools.method == "tools.effective")
        #expect(tools.params["sessionKey"]?.value as? String == "agent:reviewer:main")
        #expect(tools.params["agentId"]?.value as? String == "reviewer")
    }

    @Test func `fork and create requests preserve routing identity`() {
        let fork = OmnipolymathChatGatewayRequests.forkSession(
            parentSessionKey: "agent:reviewer:telegram:group:1",
            agentID: "reviewer")
        #expect(fork.method == "sessions.create")
        #expect(fork.params["parentSessionKey"]?.value as? String == "agent:reviewer:telegram:group:1")
        #expect(fork.params["agentId"]?.value as? String == "reviewer")
        #expect(fork.params["fork"]?.value as? Bool == true)
        #expect(fork.params["forkFrom"] == nil)

        let activeFork = OmnipolymathChatGatewayRequests.forkSession(
            parentSessionKey: "agent:reviewer:telegram:group:1",
            agentID: "reviewer",
            fromLastCompleted: true)
        #expect(activeFork.params["forkFrom"]?.value as? String == "last-completed")

        let create = OmnipolymathChatGatewayRequests.createSession(
            key: "agent:reviewer:new",
            agentID: "reviewer",
            label: nil,
            parentSessionKey: "global",
            worktree: true,
            worktreeBaseRef: " origin/release ")
        #expect(create.params["key"]?.value as? String == "agent:reviewer:new")
        #expect(create.params["agentId"]?.value as? String == "reviewer")
        #expect(create.params["parentSessionKey"]?.value as? String == "global")
        #expect(create.params["worktree"]?.value as? Bool == true)
        #expect(create.params["worktreeBaseRef"]?.value as? String == "origin/release")
    }

    @Test func `message rewind and fork requests preserve routing identity`() {
        let rewind = OmnipolymathChatGatewayRequests.rewindSession(
            sessionKey: "agent:reviewer:telegram:group:1",
            agentID: " reviewer ",
            entryId: " message-42 ")
        let fork = OmnipolymathChatGatewayRequests.forkAtMessage(
            sessionKey: "global",
            agentID: nil,
            entryId: "message-43")

        #expect(rewind.method == "sessions.rewind")
        #expect(rewind.timeoutMs == 15000)
        #expect(rewind.params["sessionKey"]?.value as? String == "agent:reviewer:telegram:group:1")
        #expect(rewind.params["agentId"]?.value as? String == "reviewer")
        #expect(rewind.params["entryId"]?.value as? String == "message-42")
        #expect(rewind.params["key"] == nil)

        #expect(fork.method == "sessions.fork")
        #expect(fork.timeoutMs == 15000)
        #expect(fork.params["sessionKey"]?.value as? String == "global")
        #expect(fork.params["agentId"] == nil)
        #expect(fork.params["entryId"]?.value as? String == "message-43")
        #expect(fork.params["key"] == nil)
    }

    @Test func `branch list and switch requests preserve routing identity`() {
        let list = OmnipolymathChatGatewayRequests.listSessionBranches(
            sessionKey: "agent:reviewer:telegram:group:1",
            agentID: " reviewer ")
        let switchBranch = OmnipolymathChatGatewayRequests.switchSessionBranch(
            sessionKey: "global",
            agentID: nil,
            leafEntryId: " leaf-42 ")

        #expect(list.method == "sessions.branches.list")
        #expect(list.timeoutMs == 15000)
        #expect(list.params["sessionKey"]?.value as? String == "agent:reviewer:telegram:group:1")
        #expect(list.params["agentId"]?.value as? String == "reviewer")
        #expect(list.params["key"] == nil)

        #expect(switchBranch.method == "sessions.branches.switch")
        #expect(switchBranch.timeoutMs == 15000)
        #expect(switchBranch.params["sessionKey"]?.value as? String == "global")
        #expect(switchBranch.params["agentId"] == nil)
        #expect(switchBranch.params["leafEntryId"]?.value as? String == "leaf-42")
        #expect(switchBranch.params["key"] == nil)
    }

    @Test func `session group requests encode exact gateway contracts`() {
        let list = OmnipolymathChatGatewayRequests.sessionGroupsList()
        let put = OmnipolymathChatGatewayRequests.sessionGroupsPut(names: ["Work", "Personal"])
        let rename = OmnipolymathChatGatewayRequests.sessionGroupsRename(name: "Work", to: "Projects")
        let delete = OmnipolymathChatGatewayRequests.sessionGroupsDelete(name: "Personal")

        #expect(list.method == "sessions.groups.list")
        #expect(list.params.isEmpty)
        #expect(put.method == "sessions.groups.put")
        #expect(put.params["names"]?.value as? [String] == ["Work", "Personal"])
        #expect(rename.method == "sessions.groups.rename")
        #expect(rename.params["name"]?.value as? String == "Work")
        #expect(rename.params["to"]?.value as? String == "Projects")
        #expect(delete.method == "sessions.groups.delete")
        #expect(delete.params["name"]?.value as? String == "Personal")
    }

    private actor MutationRequestRecorder {
        var requests: [OmnipolymathChatGatewayRequest] = []

        func send(_ request: OmnipolymathChatGatewayRequest) -> Data {
            self.requests.append(request)
            return Data()
        }
    }

    @Test func `gateway mutation lease forwards nullable fields and request timeouts`() async throws {
        let recorder = MutationRequestRecorder()
        let lease = OmnipolymathChatSessionMutationRouteLease(
            sessionTarget: {
                OmnipolymathChatSessionTarget.resolve(
                    $0,
                    selectedAgentID: "reviewer",
                    policy: .scopeBareKeysToSelectedAgent)
            },
            unreadAckContract: true,
            request: { await recorder.send($0) })
        try await lease.patchSession(
            key: "work",
            expectedSessionID: " session-a ",
            label: .some(nil),
            category: .some("Work"),
            color: .some("blue"),
            pinned: false,
            archived: nil,
            unread: nil)
        try await lease.patchSession(
            key: "work",
            expectedSessionID: "session-a",
            label: nil,
            category: nil,
            color: .some(nil),
            pinned: nil,
            archived: true,
            unread: nil)
        try await lease.deleteSession(key: "work")

        let requests = await recorder.requests
        try #require(requests.map(\.method) == ["sessions.patch", "sessions.patch", "sessions.delete"])
        #expect(requests.map(\.timeoutMs) == [15000, 600_000, 600_000])
        #expect(requests[0].params == [
            "key": AnyCodable("agent:reviewer:work"),
            "expectedSessionId": AnyCodable("session-a"),
            "label": AnyCodable(NSNull()),
            "category": AnyCodable("Work"),
            "color": AnyCodable("blue"),
            "pinned": AnyCodable(false),
        ])
        #expect(requests[1].params == [
            "key": AnyCodable("agent:reviewer:work"),
            "expectedSessionId": AnyCodable("session-a"),
            "color": AnyCodable(NSNull()),
            "archived": AnyCodable(true),
        ])
        #expect(requests[2].params == [
            "key": AnyCodable("agent:reviewer:work"),
            "deleteTranscript": AnyCodable(true),
        ])
    }

    @Test func `unknown captured read capability only blocks read mutations`() async throws {
        let recorder = MutationRequestRecorder()
        let lease = OmnipolymathChatSessionMutationRouteLease(
            sessionTarget: { OmnipolymathChatSessionTarget(sessionKey: $0, agentID: nil) },
            unreadAckContract: nil,
            request: { await recorder.send($0) })
        try await lease.patchSession(
            key: "agent:reviewer:work",
            label: nil,
            category: nil,
            pinned: true,
            archived: nil,
            unread: nil)
        try await lease.patchSession(
            key: "agent:reviewer:work",
            label: nil,
            category: nil,
            pinned: nil,
            archived: nil,
            unread: true)
        await #expect(throws: OmnipolymathChatTransportSendError.self) {
            try await lease.patchSession(
                key: "agent:reviewer:work",
                expectedMarkedUnreadAt: .some(nil),
                label: nil,
                category: nil,
                pinned: nil,
                archived: nil,
                unread: false)
        }
        let requests = await recorder.requests
        try #require(requests.count == 2)
        #expect(requests.allSatisfy { $0.method == "sessions.patch" })
        #expect(requests[0].params["pinned"]?.value as? Bool == true)
        #expect(requests[0].params["unread"] == nil)
        #expect(requests[1].params["unread"]?.value as? Bool == true)
        #expect(requests.allSatisfy { $0.params["expectedMarkedUnreadAt"] == nil })
    }

    @Test func `rename clear archive delete and fork use session mutation contracts`() {
        let rename = OmnipolymathChatGatewayRequests.patchSession(
            sessionKey: "agent:main:child",
            agentID: nil,
            label: .some(nil),
            category: nil,
            pinned: nil,
            archived: nil,
            unreadPatch: nil)
        let archive = OmnipolymathChatGatewayRequests.patchSession(
            sessionKey: "agent:main:child",
            agentID: nil,
            expectedSessionID: "session-child",
            label: nil,
            category: nil,
            pinned: nil,
            archived: true,
            unreadPatch: nil)
        let restore = OmnipolymathChatGatewayRequests.patchSession(
            sessionKey: "agent:main:child",
            agentID: nil,
            expectedSessionID: "session-child",
            label: nil,
            category: nil,
            pinned: nil,
            archived: false,
            unreadPatch: nil)
        let fork = OmnipolymathChatGatewayRequests.forkSession(
            parentSessionKey: "agent:main:child",
            agentID: nil)
        let delete = OmnipolymathChatGatewayRequests.deleteSession(
            sessionKey: "agent:main:child",
            agentID: nil)

        #expect(rename.params["label"]?.value is NSNull)
        #expect(archive.params["archived"]?.value as? Bool == true)
        #expect(archive.params["expectedSessionId"]?.value as? String == "session-child")
        #expect(archive.timeoutMs == 600_000)
        #expect(delete.method == "sessions.delete")
        #expect(delete.timeoutMs == 600_000)
        #expect(restore.params["expectedSessionId"]?.value as? String == "session-child")
        #expect(restore.timeoutMs == 15000)
        #expect(fork.method == "sessions.create")
        #expect(fork.timeoutMs == 15000)
        #expect(fork.params["parentSessionKey"]?.value as? String == "agent:main:child")
        #expect(fork.params["fork"]?.value as? Bool == true)
    }

    @Test func `chat metadata request selects session agent before fallback`() {
        let scoped = OmnipolymathChatGatewayRequests.chatMetadata(
            sessionKey: "agent:reviewer:main",
            fallbackAgentID: "fallback",
            includeSessionKey: true)
        #expect(scoped.method == "chat.metadata")
        #expect(scoped.params["agentId"]?.value as? String == "reviewer")
        #expect(scoped.params["sessionKey"]?.value as? String == "agent:reviewer:main")

        let global = OmnipolymathChatGatewayRequests.chatMetadata(
            sessionKey: "global",
            fallbackAgentID: "reviewer")
        #expect(global.params["agentId"]?.value as? String == "reviewer")
        #expect(global.params["sessionKey"] == nil)
    }

    @Test func `commands request selects session agent before fallback`() {
        let scoped = OmnipolymathChatGatewayRequests.commandsList(
            sessionKey: "agent:reviewer:main",
            fallbackAgentID: "fallback")
        #expect(scoped.params["scope"]?.value as? String == "text")
        #expect(scoped.params["includeArgs"]?.value as? Bool == true)
        #expect(scoped.params["agentId"]?.value as? String == "reviewer")

        let global = OmnipolymathChatGatewayRequests.commandsList(
            sessionKey: "global",
            fallbackAgentID: "reviewer")
        #expect(global.params["agentId"]?.value as? String == "reviewer")
    }

    @Test func `send request shares attachment encoding and timeout policy`() throws {
        let request = OmnipolymathChatGatewayRequests.sendMessage(
            sessionKey: "global",
            agentID: " reviewer ",
            expectedSessionRoutingContract: " per-sender|main|reviewer ",
            expectedSessionSettings: OmnipolymathChatSessionSettingsExpectation(
                permissionMode: .guarded,
                toolOverrides: OmnipolymathChatSessionToolOverrides(webSearch: false)),
            supportsSessionSettingsCAS: true,
            message: "hello",
            thinking: " low ",
            idempotencyKey: "send-1",
            attachments: [.init(type: "image", mimeType: "image/png", fileName: "a.png", content: "abc")])

        #expect(request.method == "chat.send")
        #expect(request.timeoutMs == 30000)
        #expect(request.params["agentId"]?.value as? String == "reviewer")
        #expect(request.params["expectedSessionRoutingContract"]?.value as? String == "per-sender|main|reviewer")
        #expect(request.params["expectedPermissionMode"]?.value as? String == "guarded")
        let expectedTools = try JSONEncoder().encode(request.params["expectedToolOverrides"])
        let expectedToolsValue = try #require(
            JSONSerialization.jsonObject(with: expectedTools) as? [String: Any])
        #expect(expectedToolsValue["webSearch"] as? Bool == false)
        #expect(request.params["thinking"]?.value as? String == "low")
        #expect(request.params["timeoutMs"] == nil)
        let encoded = try JSONEncoder().encode(request.params["attachments"])
        let json = try #require(String(bytes: encoded, encoding: .utf8))
        #expect(json.contains("a.png"))
    }

    @Test func `audio send waits for admission while explicit request deadlines remain caller owned`() {
        for timeout in [nil, 1200] as [Int?] {
            let request = OmnipolymathChatGatewayRequests.sendMessage(
                sessionKey: "main",
                agentID: nil,
                expectedSessionRoutingContract: nil,
                message: "caption",
                thinking: nil,
                idempotencyKey: "audio-send",
                attachments: [.init(type: "file", mimeType: "audio/wav", fileName: "voice.wav", content: "abc")],
                requestTimeoutMs: timeout)
            #expect(request.timeoutMs == Double(timeout ?? 0))
            #expect(request.params["timeoutMs"] == nil)
        }
    }

    @Test func `attachment send deadline leaves admission time after a slow upload`() {
        // An 8 MB file is 10,666,668 base64 bytes. URLSession reports the send
        // done once buffered, so the deadline must outlast the upload itself.
        let content = String(repeating: "A", count: 10_666_668)
        func request(_ timeout: Int?, _ attachments: [OmnipolymathChatAttachmentPayload]) -> Double {
            OmnipolymathChatGatewayRequests.sendMessage(
                sessionKey: "main",
                agentID: nil,
                expectedSessionRoutingContract: nil,
                message: "report",
                thinking: nil,
                idempotencyKey: "file-send",
                attachments: attachments,
                requestTimeoutMs: timeout).timeoutMs
        }
        let file = OmnipolymathChatAttachmentPayload(
            type: "file", mimeType: "application/pdf", fileName: "report.pdf", content: content)
        let uploadAt1MbpsMs = Double(content.utf8.count * 8 / 1000)

        // 30 s admission window plus the upload at 256 kbit/s.
        #expect(request(nil, [file]) == 30000 + 333_333)
        #expect(request(nil, [file]) > 30000 + uploadAt1MbpsMs)
        #expect(request(nil, []) == 30000)
        #expect(request(1200, [file]) == 1200)
    }

    @Test func `send request omits inherited thinking override`() {
        let inherited = OmnipolymathChatGatewayRequests.sendMessage(
            sessionKey: "global",
            agentID: nil,
            expectedSessionRoutingContract: nil,
            expectedSessionSettings: OmnipolymathChatSessionSettingsExpectation(
                permissionMode: nil,
                toolOverrides: nil),
            message: "inherit",
            thinking: nil,
            idempotencyKey: "send-inherit",
            attachments: [])
        #expect(inherited.params["thinking"] == nil)
        #expect(inherited.params["expectedPermissionMode"] == nil)
        #expect(inherited.params["expectedToolOverrides"] == nil)
    }

    @Test(arguments: [nil, .steer, .followup] as [OmnipolymathChatQueueMode?])
    func `send request preserves a per message queue mode`(mode: OmnipolymathChatQueueMode?) throws {
        let request = OmnipolymathChatGatewayRequests.sendMessage(
            sessionKey: "agent:main:main",
            agentID: nil,
            expectedSessionRoutingContract: nil,
            queueMode: mode,
            message: "Keep the original wording.",
            thinking: nil,
            idempotencyKey: "mode-choice",
            attachments: [])
        let serialized = try JSONEncoder().encode(request.params)
        let params = try #require(JSONSerialization.jsonObject(with: serialized) as? [String: Any])
        let expectedMode: String? = switch mode {
        case .steer: "steer"
        case .followup: "followup"
        case nil: nil
        }
        #expect(params["queueMode"] as? String == expectedMode)
        #expect(params["message"] as? String == "Keep the original wording.")
    }

    @Test func `question resolve request uses the gateway answer envelope`() throws {
        let request = OmnipolymathChatGatewayRequests.resolveQuestion(
            id: "ask_123",
            answers: ["meal": ["Pizza", "Salad"]])

        #expect(request.method == "question.resolve")
        let data = try JSONEncoder().encode(request.params)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let envelope = try #require(object["answers"] as? [String: Any])
        let answers = try #require(envelope["answers"] as? [String: [String]])
        #expect(answers == ["meal": ["Pizza", "Salad"]])
    }

    @Test func `question get request carries id`() {
        let request = OmnipolymathChatGatewayRequests.questionGet(id: "ask_123")

        #expect(request.method == "question.get")
        #expect(request.params["id"]?.value as? String == "ask_123")
    }

    @Test func `question cancel request uses resolve cancel contract`() {
        let request = OmnipolymathChatGatewayRequests.cancelQuestion(id: "ask_123")

        #expect(request.method == "question.resolve")
        #expect(request.params["id"]?.value as? String == "ask_123")
        #expect(request.params["cancel"]?.value as? Bool == true)
        #expect(request.params["answers"] == nil)
    }

    @Test func `long running requests share exact gateway timeout margins`() {
        #expect(OmnipolymathChatGatewayRequests.agentWait(runID: "run-1", timeoutMs: 1).timeoutMs == 5001)
        #expect(OmnipolymathChatGatewayRequests.agentWait(runID: "run-1", timeoutMs: 30000).timeoutMs == 35000)
        #expect(OmnipolymathChatGatewayRequests.compactSession(
            sessionKey: "main",
            agentID: nil).timeoutMs == 0)
    }
}

struct ChatGatewayPayloadCodecTests {
    @Test func `published catalog hello enables direct session model choices`() throws {
        let data = Data("""
        {"type":"hello-ok","protocol":4,"server":{},
         "features":{"capabilities":["published-model-catalog"]},
         "snapshot":{"presence":[],"health":{},"stateVersion":{"presence":0,"health":0},"uptimeMs":0},
         "auth":{},"policy":{}}
        """.utf8)
        let hello = try JSONDecoder().decode(HelloOk.self, from: data)

        #expect(hello.supportsServerCapability(.publishedModelCatalog))
    }

    @Test func `hello operator scopes preserve the exact advertised authorization`() {
        let snapshot = Snapshot(
            presence: [],
            health: [:],
            stateversion: StateVersion(presence: 0, health: 0),
            uptimems: 0)
        let hello = HelloOk(
            type: "hello-ok",
            _protocol: 3,
            server: [:],
            features: [:],
            snapshot: snapshot,
            auth: ["scopes": AnyCodable([
                AnyCodable("operator.read"),
                AnyCodable("operator.admin"),
            ])],
            policy: [:])
        let missing = HelloOk(
            type: "hello-ok",
            _protocol: 3,
            server: [:],
            features: [:],
            snapshot: snapshot,
            auth: [:],
            policy: [:])

        #expect(hello.advertisedOperatorScopes() == ["operator.read", "operator.admin"])
        #expect(missing.advertisedOperatorScopes() == nil)
    }

    @Test(arguments: [
        nil,
        [],
        [["runId": "watch-run", "consumedByEventId": "aggregate-user"]],
    ] as [[[String: String]]?])
    func `history decoding preserves optional input consumption receipts`(consumptions: [[String: String]]?) throws {
        var object: [String: Any] = ["sessionKey": "main", "messages": []]
        object["inputConsumptions"] = consumptions
        let payload = try JSONDecoder().decode(
            OmnipolymathChatHistoryPayload.self,
            from: JSONSerialization.data(withJSONObject: object))
        let encoded = try #require(JSONSerialization.jsonObject(
            with: JSONEncoder().encode(payload)) as? [String: Any])

        #expect(encoded["inputConsumptions"] as? [[String: String]] == consumptions)
    }

    @Test(arguments: [nil, "running", "completed", "failed", "blocked"] as [String?])
    func `history activity decodes quiet and optional terminal states`(status: String?) throws {
        var item: [String: Any] = ["itemId": "tool:work", "kind": "tool", "phase": "end", "title": "Read"]
        item["status"] = status
        let object: [String: Any] = [
            "sessionKey": "main", "messages": [],
            "activity": [["messageId": "quiet", "items": []], ["messageId": "work", "items": [item]]],
        ]
        let payload = try JSONDecoder().decode(
            OmnipolymathChatHistoryPayload.self,
            from: JSONSerialization.data(withJSONObject: object))
        #expect(payload.activity?.first?.items.isEmpty == true)
        #expect(payload.activity?.last?.items.first?.status == status)
        let roundTrip = try JSONDecoder().decode(
            OmnipolymathChatHistoryPayload.self,
            from: JSONEncoder().encode(payload))
        #expect(roundTrip.activity?.last?.items == payload.activity?.last?.items)
        let legacy = try JSONDecoder().decode(
            OmnipolymathChatHistoryPayload.self,
            from: Data(#"{"sessionKey":"main","messages":[]}"#.utf8))
        #expect(legacy.activity == nil)
    }

    @Test func `session row decodes permission and every tool override family`() throws {
        let row = try JSONDecoder().decode(OmnipolymathChatSessionEntry.self, from: Data(#"""
        {
          "key":"main","permissionMode":"guarded","toolOverrides":{
            "webSearch":false,
            "skills":{"release":false},
            "mcpServers":{"github":true},
            "mcpToolsDeny":{"github":["create_issue"]}
          }
        }
        """#.utf8))

        #expect(row.permissionMode == .guarded)
        #expect(row.toolOverrides == OmnipolymathChatSessionToolOverrides(
            webSearch: false,
            skills: ["release": false],
            mcpServers: ["github": true],
            mcpToolsDeny: ["github": ["create_issue"]]))
    }

    @Test func `session key extracts canonical agent identity`() {
        #expect(OmnipolymathChatSessionKey.agentID(from: " agent:Reviewer:main ") == "Reviewer")
        #expect(OmnipolymathChatSessionKey.agentID(from: "agent::main") == nil)
        #expect(OmnipolymathChatSessionKey.agentID(from: "global") == nil)
    }

    @Test func `agent wait distinguishes terminal and retryable timeouts`() throws {
        #expect(try OmnipolymathChatGatewayPayloadCodec.decodeAgentWaitObservation(
            Data(#"{"status":"completed"}"#.utf8)) == .terminal(.completed))
        #expect(try OmnipolymathChatGatewayPayloadCodec.decodeAgentWaitObservation(
            Data(#"{"status":"pending"}"#.utf8)) == .checkAgain)
        #expect(try OmnipolymathChatGatewayPayloadCodec.decodeAgentWaitObservation(
            Data(#"{"status":"timeout","timeoutPhase":"queue"}"#.utf8)) == .checkAgain)
        #expect(try OmnipolymathChatGatewayPayloadCodec.decodeAgentWaitObservation(
            Data(#"{"status":"timeout","timeoutPhase":"provider"}"#.utf8)) ==
            .terminal(.failed(message: "Run timed out")))
    }

    @Test func `routing identity decodes agent and canonical contract`() throws {
        let identity = try OmnipolymathChatGatewayPayloadCodec.decodeSessionRoutingIdentity(
            Data(#"{"defaultId":"Work","mainKey":"Primary","scope":"global","agents":[]}"#.utf8))

        #expect(identity.defaultAgentID == "work")
        #expect(identity.contract == "global|primary|work")
    }

    @Test func `model choices preserve metadata and replace blank names`() throws {
        let payload = Data(
            #"{"models":[{"id":"gpt-5","name":"  ","provider":"openai","available":false,"unavailableReason":"missing-auth","unavailableUntil":1234,"contextWindow":200000,"reasoning":true}]}"#
                .utf8)
        let choices = try OmnipolymathChatGatewayPayloadCodec.decodeModelChoices(payload)

        #expect(choices == [OmnipolymathChatModelChoice(
            modelID: "gpt-5",
            name: "gpt-5",
            provider: "openai",
            available: false,
            unavailableReason: "missing-auth",
            unavailableUntil: 1234,
            contextWindow: 200_000,
            reasoning: true)])
    }

    @Test func `command choice normalizes source aliases and identity`() {
        let choice = OmnipolymathChatGatewayPayloadCodec.commandChoice(CommandEntry(
            name: "review",
            textaliases: [" /review ", ""],
            description: "Review changes",
            source: AnyCodable("plugin"),
            scope: AnyCodable("text"),
            acceptsargs: true))

        #expect(choice.id == "plugin:review:/review")
        #expect(choice.textAliases == ["/review"])
        #expect(choice.source == .plugin)
        #expect(choice.acceptsArgs)
    }

    @Test func `event frames map to shared chat transport events`() {
        let sessionsChanged = EventFrame(
            type: "event",
            event: "sessions.changed",
            payload: AnyCodable([
                "sessionKey": AnyCodable("agent:main:main"),
                "agentId": AnyCodable("main"),
                "reason": AnyCodable("command-metadata"),
            ]))
        guard case let .sessionsChanged(change) = OmnipolymathChatGatewayPayloadCodec.event(from: sessionsChanged)
        else {
            Issue.record("expected sessionsChanged")
            return
        }
        #expect(change == .init(
            sessionKey: "agent:main:main",
            agentId: "main",
            reason: "command-metadata"))

        let swarmNote = EventFrame(
            type: "event",
            event: "sessions.changed",
            payload: AnyCodable([
                "sessionKey": AnyCodable("agent:main:main"),
                "reason": AnyCodable("swarm-note"),
                "swarmGroupId": AnyCodable("swarm:agent:main:main:run-1"),
                "kind": AnyCodable("phase"),
                "text": AnyCodable("Research"),
            ]))
        guard case let .sessionsChanged(note) = OmnipolymathChatGatewayPayloadCodec.event(from: swarmNote)
        else {
            Issue.record("expected swarm sessionsChanged")
            return
        }
        #expect(note.swarmGroupId == "swarm:agent:main:main:run-1")
        #expect(note.kind == "phase")
        #expect(note.text == "Research")

        let lifecycleChanged = EventFrame(
            type: "event",
            event: "sessions.changed",
            payload: AnyCodable([
                "sessionKey": AnyCodable("agent:main:main"),
                "phase": AnyCodable("end"),
                "runId": AnyCodable("run-1"),
                "session": AnyCodable([
                    "key": AnyCodable("agent:main:main"),
                    "updatedAt": AnyCodable(30000),
                    "status": AnyCodable("done"),
                    "hasActiveRun": AnyCodable(false),
                    "runtimeMs": AnyCodable(30000),
                    "outputTokens": AnyCodable(42),
                    "activeRunIds": AnyCodable([]),
                ]),
            ]))
        guard case let .sessionsChanged(lifecycle) = OmnipolymathChatGatewayPayloadCodec.event(
            from: lifecycleChanged)
        else {
            Issue.record("expected lifecycle sessionsChanged")
            return
        }
        #expect(lifecycle.reason.isEmpty)
        #expect(lifecycle.phase == "end")
        #expect(lifecycle.runId == "run-1")
        #expect(lifecycle.session?.key == "agent:main:main")
        #expect(lifecycle.session?.status == "done")
        #expect(lifecycle.session?.runtimeMs == 30000)
        #expect(lifecycle.session?.outputTokens == 42)
        #expect(lifecycle.session?.activeRunIds == [])

        let chat = EventFrame(
            type: "event",
            event: "chat",
            payload: AnyCodable([
                "runId": AnyCodable("run-1"),
                "sessionKey": AnyCodable("main"),
                "state": AnyCodable("final"),
            ]))
        guard case let .chat(payload) = OmnipolymathChatGatewayPayloadCodec.event(from: chat) else {
            Issue.record("expected chat")
            return
        }
        #expect(payload.runId == "run-1")
        #expect(payload.sessionKey == "main")
        #expect(payload.state == "final")

        let observer = EventFrame(
            type: "event",
            event: "session.observer",
            payload: AnyCodable([
                "sessionKey": AnyCodable("main"),
                "runId": AnyCodable("run-1"),
                "revision": AnyCodable(2),
                "updatedAt": AnyCodable(300),
                "headline": AnyCodable("Wrapping up"),
                "health": AnyCodable("wrapping-up"),
            ]))
        guard case let .sessionObserver(digest) = OmnipolymathChatGatewayPayloadCodec.event(from: observer)
        else {
            Issue.record("expected sessionObserver")
            return
        }
        #expect(digest.sessionkey == "main")
        #expect(digest.runid == "run-1")
        #expect(digest.revision == 2)

        let progressCard = EventFrame(
            type: "event",
            event: "progressCard.changed",
            payload: AnyCodable([
                "sessionKey": AnyCodable("agent:main:main"),
                "revision": AnyCodable(7),
            ]))
        guard case let .progressCardChanged(event) = OmnipolymathChatGatewayPayloadCodec.event(
            from: progressCard)
        else {
            Issue.record("expected progressCardChanged")
            return
        }
        #expect(event.sessionkey == "agent:main:main")
        #expect(event.revision.value as? Int == 7)

        guard case .chatMetadataChanged = OmnipolymathChatGatewayPayloadCodec.event(from: EventFrame(
            type: "event",
            event: "chat.metadata.changed"))
        else {
            Issue.record("expected chatMetadataChanged")
            return
        }

        for eventName in ["chat.metadata.changed", "config.changed"] {
            guard case .modelSelectionChanged = OmnipolymathChatGatewayPayloadCodec.event(from: EventFrame(
                type: "event",
                event: eventName,
                payload: eventName == "chat.metadata.changed" ? AnyCodable(["modelSelectionChanged": true]) : nil))
            else {
                Issue.record("expected modelSelectionChanged for \(eventName)")
                return
            }
        }

        #expect(OmnipolymathChatGatewayPayloadCodec.event(from: EventFrame(
            type: "event",
            event: "unknown")) == nil)
    }

    @Test func `session change decoding distinguishes absent fields from explicit clears`() {
        func decode(_ fields: [String: AnyCodable]) throws -> OmnipolymathChatSessionsChangedEvent {
            let frame = EventFrame(
                type: "event",
                event: "sessions.changed",
                payload: AnyCodable(fields))
            guard case let .sessionsChanged(change) = OmnipolymathChatGatewayPayloadCodec.event(from: frame)
            else {
                throw CancellationError()
            }
            return change
        }

        let partial = try? decode([
            "sessionKey": AnyCodable("main"),
            "reason": AnyCodable("message"),
            "updatedAt": AnyCodable(200),
        ])
        #expect(partial?.colorPresent == false)
        #expect(partial?.agentStatusPresent == false)
        #expect(partial?.observerDigestPresent == false)
        #expect(partial?.statusPresent == false)
        #expect(partial?.lastRunErrorPresent == false)

        let cleared = try? decode([
            "sessionKey": AnyCodable("main"),
            "reason": AnyCodable("patch"),
            "color": AnyCodable(NSNull()),
            "agentStatus": AnyCodable(NSNull()),
            "observerDigest": AnyCodable(NSNull()),
            "status": AnyCodable(NSNull()),
            "lastRunError": AnyCodable(NSNull()),
        ])
        #expect(cleared?.colorPresent == true)
        #expect(cleared?.color == nil)
        #expect(cleared?.agentStatusPresent == true)
        #expect(cleared?.observerDigestPresent == true)
        #expect(cleared?.statusPresent == true)
        #expect(cleared?.lastRunErrorPresent == true)
    }

    @Test func `session change decodes nested fallback with outer null precedence and no reason`() throws {
        let data = Data("""
        {
          "sessionKey": null,
          "color": null,
          "status": null,
          "session": {
            "key": "agent:main:child",
            "color": "blue",
            "agentId": "main",
            "parentSessionKey": "agent:main:parent",
            "status": "running",
            "lastRunError": null,
            "hasActiveRun": true,
            "swarmGroupId": "swarm:agent:main:parent:turn-1"
          }
        }
        """.utf8)

        let event = try JSONDecoder().decode(OmnipolymathChatSessionsChangedEvent.self, from: data)
        #expect(event.reason.isEmpty)
        #expect(event.sessionKey == nil)
        #expect(event.color == nil)
        #expect(event.colorPresent)
        #expect(event.agentId == "main")
        #expect(event.parentSessionKey == "agent:main:parent")
        #expect(event.status == nil)
        #expect(event.statusPresent)
        #expect(event.lastRunError == nil)
        #expect(event.lastRunErrorPresent)
        #expect(event.hasActiveRun == true)
        #expect(event.swarmGroupId == "swarm:agent:main:parent:turn-1")
    }

    @Test func `session change remains codable without exposing presence flags`() throws {
        let event = OmnipolymathChatSessionsChangedEvent(
            sessionKey: "agent:main:work",
            agentId: "main",
            reason: "run-progress",
            updatedAt: 200,
            lastReadAt: 100,
            color: nil,
            agentStatus: .init(note: "Reviewing", expiresAt: 500, attention: "hand"),
            observerDigest: .init(
                runId: "run-1",
                revision: 2,
                updatedAt: 200,
                headline: "On track",
                health: "on-track"),
            status: "running",
            lastRunError: "Previous warning",
            hasActiveRun: true,
            activeRunIds: ["run-1"],
            startedAt: 50,
            endedAt: nil,
            colorPresent: true)

        let data = try JSONEncoder().encode(event)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object["colorPresent"] == nil)
        #expect(object["color"] is NSNull)
        #expect(object["agentStatusPresent"] == nil)
        #expect(object["observerDigestPresent"] == nil)
        #expect(object["statusPresent"] == nil)
        #expect(object["lastRunErrorPresent"] == nil)
        #expect(try JSONDecoder().decode(OmnipolymathChatSessionsChangedEvent.self, from: data) == event)
    }
}
