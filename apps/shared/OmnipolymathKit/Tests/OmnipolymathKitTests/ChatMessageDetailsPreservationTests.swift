import Foundation
import OmnipolymathKit
import Testing
@testable import OmnipolymathChatUI

/// Tool-result diff metadata rides on `OmnipolymathChatMessage.details`; every
/// field-enumerating message rebuild must carry it or inline diffs silently
/// disappear after cache-warm reconciliation.
@Suite("ChatMessageDetailsPreservation")
struct ChatMessageDetailsPreservationTests {
    private func toolResultMessage(id: UUID = UUID()) -> OmnipolymathChatMessage {
        OmnipolymathChatMessage(
            id: id,
            role: "toolResult",
            content: [
                OmnipolymathChatMessageContent(
                    type: "text",
                    text: "Successfully replaced 1 block(s).",
                    mimeType: nil,
                    fileName: nil,
                    content: nil),
            ],
            timestamp: 1,
            transcriptMessageID: "tool-result",
            toolCallId: "call-1",
            toolName: "edit",
            details: AnyCodable(["diff": AnyCodable("+1 added\n-1 removed")]))
    }

    private func systemNoticeMessage(id: UUID = UUID()) -> OmnipolymathChatMessage {
        OmnipolymathChatMessage(
            id: id,
            role: "user",
            content: [
                OmnipolymathChatMessageContent(
                    type: "text",
                    text: "[System] gateway restarted",
                    mimeType: nil,
                    fileName: nil,
                    content: nil,
                    preview: OmnipolymathChatCanvasPreview(
                        kind: "canvas",
                        surface: "assistant_message",
                        render: "url",
                        title: "Restart details",
                        preferredHeight: 320,
                        url: "/__omnipolymath__/canvas/restart",
                        viewId: "restart-preview",
                        sandbox: "scripts"),
                    runId: "restart-run"),
            ],
            timestamp: 2,
            provenance: OmnipolymathChatInputProvenance(
                kind: "internal_system",
                sourceTool: "restart-sentinel"))
    }

    @MainActor @Test func `decode pipeline keeps message details`() throws {
        let payloadData = try JSONEncoder().encode([self.toolResultMessage(), self.systemNoticeMessage()])
        let anyMessages = try JSONDecoder().decode([AnyCodable].self, from: payloadData)
        let activity = try JSONDecoder().decode(
            [OmnipolymathChatHistoryActivity].self,
            from: Data(#"[{"messageId":"tool-result","items":[]}]"#.utf8))
        let decoded = OmnipolymathChatViewModel.decodeMessages(anyMessages, activity: activity)

        #expect(decoded.first?.activity == [])
        #expect(decoded.last?.activity == nil)
        #expect(decoded.first?.details != nil)
        #expect(decoded.last?.provenance?.sourceTool == "restart-sentinel")
        #expect(decoded.last?.content.first?.preview == self.systemNoticeMessage().content.first?.preview)
        #expect(decoded.last?.content.first?.runId == "restart-run")
    }

    @MainActor @Test func `canonical adoption keeps incoming details`() {
        let incoming = self.toolResultMessage()
        let existing = self.toolResultMessage()

        let adopted = OmnipolymathChatViewModel.adoptingCanonicalMessage(incoming, over: existing)

        #expect(adopted.id == existing.id)
        #expect(adopted.details != nil)

        let incomingNotice = self.systemNoticeMessage()
        let adoptedNotice = OmnipolymathChatViewModel.adoptingCanonicalMessage(
            incomingNotice,
            over: self.systemNoticeMessage())
        #expect(adoptedNotice.provenance == incomingNotice.provenance)
    }
}
