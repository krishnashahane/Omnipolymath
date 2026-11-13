import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";

export function fixedStoreOwnershipConfig(storePath: string, owned = true): OmnipolymathConfig {
  return {
    session: { scope: "global", store: storePath },
    agents: {
      ownership: "explicit",
      ...(owned ? { defaults: { sessionStore: { agentId: "ops" } } } : {}),
      entries: { ops: {}, research: {} },
    },
  };
}
