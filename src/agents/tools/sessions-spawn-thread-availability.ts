import { supportsThreadBindingSpawn } from "../../channels/conversation-resolution.js";
import { resolveThreadBindingSpawnPolicy } from "../../channels/thread-bindings-policy.js";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";

/** Whether the requester's channel can bind a new native or ACP child to a thread. */
export function resolveSessionsSpawnThreadAvailability(opts?: {
  config?: OmnipolymathConfig;
  agentChannel?: string;
  agentAccountId?: string;
}) {
  const channel = opts?.agentChannel;
  const cfg = opts?.config;
  if (!channel || !cfg || !supportsThreadBindingSpawn(channel)) {
    return { subagent: false, acp: false };
  }
  const resolve = (kind: "subagent" | "acp") => {
    const policy = resolveThreadBindingSpawnPolicy({
      cfg,
      channel,
      accountId: opts?.agentAccountId,
      kind,
    });
    return policy.enabled && policy.spawnEnabled;
  };
  return {
    subagent: resolve("subagent"),
    acp: resolve("acp"),
  };
}
