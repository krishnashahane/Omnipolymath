import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";

export function createVisitorAccessPluginConfig(
  accountId: string,
  appId: string,
  apiToken: string,
): NonNullable<OmnipolymathConfig["plugins"]> {
  return {
    allow: ["visitor-access"],
    slots: { memory: "none" },
    entries: { "visitor-access": { enabled: true, config: { accountId, appId, apiToken } } },
  };
}
