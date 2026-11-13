import { isDeepStrictEqual } from "node:util";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { SessionMutationFactsUnavailableError } from "./session-sharing-incognito.js";
import { readSessionRoutingFacts, type SessionRoutingTarget } from "./session-store-key.js";

export function captureSessionMutationRouting(
  cfg: OmnipolymathConfig,
  changed: () => Error = () => new SessionMutationFactsUnavailableError(),
  targets?: readonly SessionRoutingTarget[],
) {
  const capturedTargets = targets?.length
    ? targets.map(({ sessionKey, agentId, preserveQualifiedAddress }) => ({
        sessionKey,
        agentId,
        preserveQualifiedAddress,
      }))
    : undefined;
  const route = readSessionRoutingFacts(cfg, capturedTargets);
  return (current: OmnipolymathConfig) => {
    if (!isDeepStrictEqual(readSessionRoutingFacts(current, capturedTargets), route)) {
      throw changed();
    }
  };
}
