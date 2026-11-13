import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";

export function enableDefaultOnboardingInternalHooks(cfg: OmnipolymathConfig): OmnipolymathConfig {
  const existingInternal = cfg.hooks?.internal;
  const entry = existingInternal?.entries?.["session-memory"];
  if (existingInternal?.enabled === false || entry?.enabled === false || entry?.enabled === true) {
    return cfg;
  }

  return {
    ...cfg,
    hooks: {
      ...cfg.hooks,
      internal: {
        ...existingInternal,
        entries: {
          ...existingInternal?.entries,
          "session-memory": { ...entry, enabled: true },
        },
      },
    },
  };
}
