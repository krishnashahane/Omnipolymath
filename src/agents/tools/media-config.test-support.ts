import { setRuntimeConfigSnapshot } from "../../config/runtime-snapshot.js";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";

export function configWithDefaults(
  defaults: NonNullable<NonNullable<OmnipolymathConfig["agents"]>["defaults"]>,
): OmnipolymathConfig {
  const config = { agents: { defaults } };
  setRuntimeConfigSnapshot(config, config);
  return config;
}
