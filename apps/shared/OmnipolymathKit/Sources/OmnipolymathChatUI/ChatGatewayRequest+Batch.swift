#if os(macOS)
import Foundation
import OmnipolymathProtocol

extension OmnipolymathChatGatewayRequests {
    static func sidebarPinOrder(_ entries: [String], hash: String) throws -> OmnipolymathChatGatewayRequest {
        let raw = try JSONEncoder().encode(["ui": ["prefs": ["sidebarEntries": entries]]])
        return .init(
            method: "config.patch",
            params: [
                "raw": .init(String(bytes: raw, encoding: .utf8)!), "baseHash": .init(hash),
                "replacePaths": .init(["ui.prefs.sidebarEntries"]), "note": .init("control-ui prefs sync"),
            ],
            timeoutMs: 15000)
    }

    static func sidebarBatchPatch(
        _ rows: [OmnipolymathChatSessionEntry], patch: [String: AnyCodable]) -> OmnipolymathChatGatewayRequest
    {
        let targets = rows.map { row in
            var target = self.sessionMenuTarget(row)
            if let id = row.sessionId { target["expectedSessionId"] = .init(id) }
            return target
        }
        // ui/src/lib/sessions/session-requests.ts:189: archive waits for workspace reconciliation.
        return .init(
            method: "sessions.patchMany",
            params: ["targets": .init(targets), "patch": .init(patch)],
            timeoutMs: patch["archived"]?.value as? Bool == true ? 600_000 : 15000)
    }

    static func sidebarBatchDelete(_ row: OmnipolymathChatSessionEntry) -> OmnipolymathChatGatewayRequest {
        var params = self.sessionMenuTarget(row)
        params["deleteTranscript"] = .init(true)
        if let id = row.sessionId { params["expectedSessionId"] = .init(id) }
        if row.isArchived { params["archivedOnly"] = .init(true) }
        return .init(method: "sessions.delete", params: params, timeoutMs: 600_000)
    }
}
#endif
