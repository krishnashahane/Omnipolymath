import { resolveDefaultAgentId } from "omnipolymath/plugin-sdk/agent-scope-runtime";
import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import { normalizeAgentId } from "omnipolymath/plugin-sdk/routing";
import type { VoiceCallConfig } from "./config.js";
import type { CallRecord } from "./types.js";

/** Setup and startup must resolve the same owner before provisioning telephony. */
export function resolveVoiceCallAgentId(
  config: Pick<VoiceCallConfig, "agentId">,
  coreConfig: OmnipolymathConfig,
): string {
  return config.agentId
    ? normalizeAgentId(config.agentId)
    : resolveDefaultAgentId(coreConfig, {
        surface: "Voice Call",
        hint: "Set plugins.entries.voice-call.config.agentId to a configured agent ID.",
      });
}

export function resolveCallAgentId(call: Pick<CallRecord, "agentId">): string {
  if (!call.agentId?.trim()) {
    throw new Error(
      "Voice Call has no recorded agent owner. Start a new call and hang up any remaining call with your provider; saved history is unchanged.",
    );
  }
  return normalizeAgentId(call.agentId);
}
