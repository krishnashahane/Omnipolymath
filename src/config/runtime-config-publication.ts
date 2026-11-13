import type { OmnipolymathConfig } from "./types.omnipolymath.js";

/** The runtime config owner publishes identity facts before notifying consumers. */
export const runtimeConfigPublication: {
  current?: { config: OmnipolymathConfig; revision: object };
} = {};
