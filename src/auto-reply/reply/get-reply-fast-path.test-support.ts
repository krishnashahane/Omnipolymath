import type { ModelAliasIndex } from "../../agents/model-selection.js";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import { markReplyConfigRuntimeMode } from "./reply-config-runtime-mode.js";

export function markCompleteReplyConfig<T extends OmnipolymathConfig>(
  config: T,
  options?: { runtimeMode?: "fast" | "full" },
): T {
  return markReplyConfigRuntimeMode(config, options?.runtimeMode ?? "fast");
}

export function withFastReplyConfig<T extends OmnipolymathConfig>(config: T): T {
  return markCompleteReplyConfig(config);
}

export function emptyAliasIndex(): ModelAliasIndex {
  return { byAlias: new Map(), byKey: new Map() };
}
