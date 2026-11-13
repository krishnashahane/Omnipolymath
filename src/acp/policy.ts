import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { AcpRuntimeError } from "./runtime/errors.js";

const ACP_DISABLED_MESSAGE = "ACP is disabled by policy (`acp.enabled=false`).";
const ACP_DISPATCH_DISABLED_MESSAGE =
  "ACP dispatch is disabled by policy (`acp.dispatch.enabled=false`).";

export function isAcpEnabledByPolicy(cfg: OmnipolymathConfig): boolean {
  return cfg.acp?.enabled !== false;
}

export function resolveAcpDispatchPolicyMessage(cfg: OmnipolymathConfig): string | null {
  if (!isAcpEnabledByPolicy(cfg)) {
    return ACP_DISABLED_MESSAGE;
  }
  return cfg.acp?.dispatch?.enabled === false ? ACP_DISPATCH_DISABLED_MESSAGE : null;
}

export function resolveAcpDispatchPolicyError(cfg: OmnipolymathConfig): AcpRuntimeError | null {
  const message = resolveAcpDispatchPolicyMessage(cfg);
  if (!message) {
    return null;
  }
  return new AcpRuntimeError("ACP_DISPATCH_DISABLED", message);
}

/** Returns the runtime error for explicit ACP turns when ACP itself is disabled. */
export function resolveAcpExplicitTurnPolicyError(cfg: OmnipolymathConfig): AcpRuntimeError | null {
  if (isAcpEnabledByPolicy(cfg)) {
    return null;
  }
  return new AcpRuntimeError("ACP_DISPATCH_DISABLED", ACP_DISABLED_MESSAGE);
}

function listAcpAllowedAgentIds(cfg: OmnipolymathConfig): string[] {
  return (cfg.acp?.allowedAgents ?? []).map(normalizeAgentId).filter(Boolean);
}

/** Returns whether `acp.allowedAgents` restricts ACP target ids. */
export function hasAcpAgentAllowlist(cfg: OmnipolymathConfig): boolean {
  return listAcpAllowedAgentIds(cfg).length > 0;
}

export function resolveAcpAgentPolicyError(
  cfg: OmnipolymathConfig,
  agentId: string,
): AcpRuntimeError | null {
  const allowed = listAcpAllowedAgentIds(cfg);
  if (allowed.length === 0 || allowed.includes(normalizeAgentId(agentId))) {
    return null;
  }
  return new AcpRuntimeError(
    "ACP_SESSION_INIT_FAILED",
    `ACP agent "${normalizeAgentId(agentId)}" is not allowed by policy.`,
  );
}
