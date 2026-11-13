import type { OmnipolymathConfig } from "../../../config/types.omnipolymath.js";
import { resolveAgentConfig } from "../../agent-scope-config.js";

const DEFAULT_SWARM_CONFIG = {
  enabled: true,
  maxConcurrent: 32,
  maxChildrenPerGroup: 50,
  maxTotalPerGroup: 200,
  waitTimeoutSecondsMax: 600,
  defaultAgentId: "",
};

type SwarmConfig = NonNullable<OmnipolymathConfig["tools"]>["swarm"];

function normalizeRawConfig(value: SwarmConfig): Exclude<SwarmConfig, boolean> {
  return typeof value === "boolean" ? { enabled: value } : value;
}

/** Resolve global and per-agent Swarm configuration into bounded runtime values. */
export function resolveSwarmConfig(
  config?: OmnipolymathConfig,
  agentId?: string,
): typeof DEFAULT_SWARM_CONFIG {
  const globalRaw = normalizeRawConfig(config?.tools?.swarm) ?? {};
  const agentRaw =
    config && agentId
      ? normalizeRawConfig(resolveAgentConfig(config, agentId)?.tools?.swarm)
      : undefined;
  const raw = agentRaw ? { ...globalRaw, ...agentRaw } : globalRaw;
  return {
    enabled: raw.enabled ?? DEFAULT_SWARM_CONFIG.enabled,
    maxConcurrent: Math.min(raw.maxConcurrent ?? DEFAULT_SWARM_CONFIG.maxConcurrent, 1_000),
    maxChildrenPerGroup: Math.min(
      raw.maxChildrenPerGroup ?? DEFAULT_SWARM_CONFIG.maxChildrenPerGroup,
      10_000,
    ),
    maxTotalPerGroup: Math.min(
      raw.maxTotalPerGroup ?? DEFAULT_SWARM_CONFIG.maxTotalPerGroup,
      100_000,
    ),
    waitTimeoutSecondsMax: Math.min(
      raw.waitTimeoutSecondsMax ?? DEFAULT_SWARM_CONFIG.waitTimeoutSecondsMax,
      24 * 60 * 60,
    ),
    defaultAgentId: raw.defaultAgentId?.trim() ?? "",
  };
}
