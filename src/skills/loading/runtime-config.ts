import { getRuntimeConfigSnapshot } from "../../config/runtime-snapshot.js";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import { parseSecretRef } from "../../config/types.secrets.js";

// Raw skill secret refs must not be replaced by redacted runtime snapshots.
function hasConfiguredSkillApiKeyRef(config?: OmnipolymathConfig): boolean {
  return Object.values(config?.skills?.entries ?? {}).some(
    (skillConfig) => parseSecretRef(skillConfig.apiKey) !== null,
  );
}

/** Chooses the runtime config snapshot unless it would hide skill secret refs. */
export function resolveSkillRuntimeConfig(config?: OmnipolymathConfig): OmnipolymathConfig | undefined {
  const runtimeConfig = getRuntimeConfigSnapshot();
  if (!runtimeConfig) {
    return config;
  }
  if (!config) {
    return runtimeConfig;
  }
  const runtimeHasRawSkillSecretRefs = hasConfiguredSkillApiKeyRef(runtimeConfig);
  const configHasRawSkillSecretRefs = hasConfiguredSkillApiKeyRef(config);
  if (runtimeHasRawSkillSecretRefs && !configHasRawSkillSecretRefs) {
    return config;
  }
  return runtimeConfig;
}
