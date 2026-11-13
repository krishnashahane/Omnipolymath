import { collectConfigRuntimeEnvVars } from "./env-vars.js";
import type { OmnipolymathConfig } from "./types.js";

export const GATEWAY_CONFIG_SELECTION_ENV_KEYS: ReadonlySet<string> = new Set([
  "ANDROID_DATA",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "OMNIPOLYMATH_AGENT_DIR",
  "OMNIPOLYMATH_CONFIG_PATH",
  "OMNIPOLYMATH_HOME",
  "OMNIPOLYMATH_INCLUDE_ROOTS",
  "OMNIPOLYMATH_CONFIG_READONLY",
  "OMNIPOLYMATH_NIX_MODE",
  "OMNIPOLYMATH_OAUTH_DIR",
  "OMNIPOLYMATH_PACKAGE_DIR",
  "OMNIPOLYMATH_PROFILE",
  "OMNIPOLYMATH_STATE_DIR",
  "OMNIPOLYMATH_WORKSPACE_DIR",
  "PI_CODING_AGENT_DIR",
  "PREFIX",
  "USERPROFILE",
]);

/** Rejects config.env changes that would retarget a running Gateway process. */
export function assertGatewayConfigEnvSelectionUnchanged(
  previousConfig: OmnipolymathConfig,
  nextConfig: OmnipolymathConfig,
): void {
  const normalize = (config: OmnipolymathConfig) =>
    new Map(
      Object.entries(collectConfigRuntimeEnvVars(config)).map(([key, value]) => [
        key.toUpperCase(),
        value,
      ]),
    );
  const previous = normalize(previousConfig);
  const next = normalize(nextConfig);
  for (const key of GATEWAY_CONFIG_SELECTION_ENV_KEYS) {
    if (previous.get(key) !== next.get(key)) {
      throw new Error(
        `Config env cannot change process-stable Gateway selector ${key} during reload. Restart with the target environment instead.`,
      );
    }
  }
}
