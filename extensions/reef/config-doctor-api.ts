import type { ChannelDoctorLegacyConfigRule } from "omnipolymath/plugin-sdk/channel-contract";
import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import { defineStrayPluginEntryConfigMigration } from "omnipolymath/plugin-sdk/runtime-doctor-migrations";
import { isRecord } from "omnipolymath/plugin-sdk/string-coerce-runtime";
import { ReefChannelConfigSchema } from "./src/config-schema.js";

function hasRetiredReefPolicyConfig(value: unknown): boolean {
  return isRecord(value) && ["dmPolicy", "allowFrom"].some((key) => Object.hasOwn(value, key));
}

// Reef reads channels.reef only. Older manifests advertised the full channel
// schema as plugin-entry config, so a Control UI plugin form could park values
// under plugins.entries.reef.config where the runtime never saw them.
const reefStrayEntryConfigMigration = defineStrayPluginEntryConfigMigration({
  pluginId: "reef",
  channelId: "reef",
  validateMergedChannelConfig: (merged) => ReefChannelConfigSchema.safeParse(merged).success,
});

export const legacyConfigRules: ChannelDoctorLegacyConfigRule[] = [
  {
    path: ["channels", "reef"],
    message:
      'channels.reef dmPolicy/allowFrom are legacy; run "omnipolymath doctor --fix" to remove them. Peer trust is SQLite-backed.',
    match: hasRetiredReefPolicyConfig,
  },
  reefStrayEntryConfigMigration.legacyConfigRule,
];

export function normalizeCompatibilityConfig({ cfg }: { cfg: OmnipolymathConfig }): {
  config: OmnipolymathConfig;
  changes: string[];
} {
  const reef = cfg.channels?.reef;
  let config = cfg;
  const changes: string[] = [];
  if (hasRetiredReefPolicyConfig(reef)) {
    const next = structuredClone(cfg);
    const nextReef = next.channels?.reef;
    if (isRecord(nextReef)) {
      for (const key of ["dmPolicy", "allowFrom"] as const) {
        if (Object.hasOwn(nextReef, key)) {
          delete nextReef[key];
          changes.push(`Removed retired Reef ${key} field.`);
        }
      }
      config = next;
    }
  }
  const stray = reefStrayEntryConfigMigration.normalizeConfig({ cfg: config });
  return { config: stray.config, changes: [...changes, ...stray.changes] };
}
