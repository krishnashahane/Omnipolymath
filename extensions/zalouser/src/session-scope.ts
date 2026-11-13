import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";

export function resolveZalouserDmSessionScope(config: OmnipolymathConfig) {
  const configured = config.session?.dmScope;
  return configured === "main" || !configured ? "per-channel-peer" : configured;
}
