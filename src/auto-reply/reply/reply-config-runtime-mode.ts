import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";

// Reply completeness is process-local metadata. Keep it off config objects so
// frozen runtime snapshots and identity-keyed caches remain valid.
const replyConfigRuntimeModes = new WeakMap<OmnipolymathConfig, "fast" | "full">();

export function markReplyConfigRuntimeMode<T extends OmnipolymathConfig>(
  config: T,
  runtimeMode: "fast" | "full",
): T {
  replyConfigRuntimeModes.set(config, runtimeMode);
  return config;
}

export function isCompleteReplyConfig(config: unknown): config is OmnipolymathConfig {
  return Boolean(
    config && typeof config === "object" && replyConfigRuntimeModes.has(config as OmnipolymathConfig),
  );
}

export function usesFullReplyRuntime(config: unknown): boolean {
  if (!config || typeof config !== "object") {
    return false;
  }
  const mode = replyConfigRuntimeModes.get(config as OmnipolymathConfig);
  return mode === "full";
}
