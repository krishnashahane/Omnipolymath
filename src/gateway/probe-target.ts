import { normalizeOptionalString } from "@omnipolymath/normalization-core/string-coerce";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";

// Probe target resolution converts configured gateway mode into the actual
// reachable target. Remote mode falls back to local probing when no remote URL
// exists so startup diagnostics can explain the missing URL.
export type GatewayProbeTargetResolution = {
  gatewayMode: "local" | "remote";
  mode: "local" | "remote";
  remoteUrlMissing: boolean;
};

export function resolveGatewayProbeTarget(cfg: OmnipolymathConfig): GatewayProbeTargetResolution {
  const gatewayMode = cfg.gateway?.mode === "remote" ? "remote" : "local";
  const remoteUrlRaw = normalizeOptionalString(cfg.gateway?.remote?.url) ?? "";
  const remoteUrlMissing = gatewayMode === "remote" && !remoteUrlRaw;
  return {
    gatewayMode,
    mode: gatewayMode === "remote" && !remoteUrlMissing ? "remote" : "local",
    remoteUrlMissing,
  };
}
