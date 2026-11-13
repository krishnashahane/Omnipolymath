import { normalizeOptionalString } from "@omnipolymath/normalization-core/string-coerce";
import { collectDurableServiceEnvVars } from "../config/state-dir-dotenv.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { hasConfiguredSecretInput } from "../config/types.secrets.js";

/** Decide whether install should require token auth when no durable password source exists. */
export function shouldRequireGatewayTokenForInstall(
  cfg: OmnipolymathConfig,
  env: NodeJS.ProcessEnv,
): boolean {
  switch (cfg.gateway?.auth?.mode) {
    case "token":
      return true;
    case "password":
    case "none":
    case "trusted-proxy":
      return false;
    case undefined:
      break;
  }

  if (hasConfiguredSecretInput(cfg.gateway?.auth?.password, cfg.secrets?.defaults)) {
    return false;
  }

  // Service install should only infer password mode from durable sources that
  // survive outside the invoking shell.
  const durableServiceEnv = collectDurableServiceEnvVars({ env, config: cfg });
  return !normalizeOptionalString(durableServiceEnv.OMNIPOLYMATH_GATEWAY_PASSWORD);
}
