import Foundation
import OmnipolymathKit

public typealias OmnipolymathChatToolActivityHandler = @MainActor @Sendable (
    _ id: String,
    _ name: String,
    _ isActive: Bool,
    _ sessionKey: String) -> Void

extension OmnipolymathChatViewModel {
    public var pendingToolCalls: [OmnipolymathChatPendingToolCall] {
        self.toolActivities.filter { !$0.isComplete }
    }

    public func endPendingToolActivities() {
        self.turnToolCallsById = [:]
    }

    func handleAgentActivityItem(_ evt: OmnipolymathAgentEventPayload) {
        guard evt.data["kind"]?.value as? String != "preamble",
              let activity = try? GatewayPayloadDecoding.decode(
                  AnyCodable(evt.data), as: OmnipolymathAgentActivityItem.self),
              activity.suppressChannelProgress != true
        else { return }
        let toolCallId = activity.toolCallId ?? activity.itemId
        var pending = self.turnToolCallsById[toolCallId] ?? OmnipolymathChatPendingToolCall(
            toolCallId: toolCallId,
            name: activity.name ?? activity.title,
            args: nil,
            startedAt: evt.ts.map(Double.init),
            isError: nil,
            diffStat: nil)
        pending.runID = evt.runId
        pending.activity = activity
        pending.isComplete = activity.phase == "end"
        self.turnToolCallsById[toolCallId] = pending
    }

    func prepareToolActivities(
        from previous: [String: OmnipolymathChatPendingToolCall]) -> [OmnipolymathChatPendingToolCall]
    {
        let priorActive = previous.filter { !$0.value.isComplete && $0.value.activity?.isVisible != false }
        let currentActive = self.turnToolCallsById.filter {
            !$0.value.isComplete && $0.value.activity?.isVisible != false
        }
        for (id, call) in priorActive where currentActive[id] == nil {
            let name = ToolDisplayRegistry.displayCall(name: call.name, args: call.args).name ?? call.name
            self.onToolActivity?(id, name, false, self.sessionKey)
        }
        for (id, call) in currentActive where priorActive[id] == nil {
            let name = ToolDisplayRegistry.displayCall(name: call.name, args: call.args).name ?? call.name
            self.onToolActivity?(id, name, true, self.sessionKey)
        }
        return self.turnToolCallsById.values.sorted {
            if $0.isComplete != $1.isComplete { return !$0.isComplete }
            return ($0.startedAt ?? 0) < ($1.startedAt ?? 0)
        }
    }
}
