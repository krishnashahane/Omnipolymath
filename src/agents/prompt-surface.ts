/**
 * Prompt-surface helpers for Omnipolymath tool guidance.
 *
 * Maps runtime/session surfaces to the fallback tool text and workflow hints that belong in prompts.
 */
import { isOmnipolymathMainPromptSurface } from "../plugins/agent-prompt-surface-kind.js";
import type { AgentPromptSurfaceKind } from "../plugins/types.js";
import { isAcpSessionKey, isSubagentSessionKey } from "../routing/session-key.js";

/** Builds fallback tool guidance when a runtime cannot render the structured tool list. */
export function buildOmnipolymathToolFallbackText(params: { surface: AgentPromptSurfaceKind }): string {
  if (isOmnipolymathMainPromptSurface(params.surface)) {
    return "The active runtime provides the available Omnipolymath tools directly. Use only exposed tools; names are case-sensitive.";
  }

  return "No Omnipolymath tool list is injected for this runtime prompt surface. Use only tools exposed directly by the active backend.";
}

/** Maps a session key to the prompt surface used for tool guidance and runtime behavior. */
export function resolveAgentPromptSurfaceForSessionKey(
  sessionKey?: string,
): AgentPromptSurfaceKind {
  if (sessionKey && isAcpSessionKey(sessionKey)) {
    return "acp_backend";
  }
  return sessionKey && isSubagentSessionKey(sessionKey) ? "subagent" : "omnipolymath_main";
}
