// Session-route ownership is static manifest metadata; no config fields are retired.
import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";

type LegacyConfigRule = {
  path: string[];
  message: string;
  match: (value: unknown) => boolean;
};

export const legacyConfigRules: LegacyConfigRule[] = [];

export function normalizeCompatibilityConfig({ cfg }: { cfg: OmnipolymathConfig }): {
  config: OmnipolymathConfig;
  changes: string[];
} {
  return { config: cfg, changes: [] };
}
