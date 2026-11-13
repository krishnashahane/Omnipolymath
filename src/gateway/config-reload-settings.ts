import type { GatewayReloadMode } from "../config/types.gateway.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";

export function resolveGatewayReloadSettings(
  cfg: OmnipolymathConfig,
  debounceMs = 300,
): { mode: GatewayReloadMode; debounceMs: number } {
  return { mode: cfg.gateway?.reload?.mode === "off" ? "off" : "hybrid", debounceMs };
}
