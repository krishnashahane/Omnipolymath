import type {
  ChannelDoctorConfigMutation,
  ChannelDoctorLegacyConfigRule,
} from "omnipolymath/plugin-sdk/channel-contract";
import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import {
  createLegacyWebhookListenerDoctorContract,
  defineChannelAliasMigration,
} from "omnipolymath/plugin-sdk/runtime-doctor-migrations";
import { resolveMSTeamsCredentials } from "./src/token-config.js";

const webhookMigration = createLegacyWebhookListenerDoctorContract({
  channelKey: "msteams",
  defaultPort: 3978,
  webhookKey: "webhook",
  portKey: "port",
  hostKey: null,
  preserveAuthoredActivation: true,
});
export const { historicalWebhookListener } = webhookMigration;

const streamingAliasMigration = defineChannelAliasMigration({
  channelId: "msteams",
  // Teams previews default to partial streaming, matching the runtime default
  // in reply-dispatcher when no mode is configured.
  streaming: { defaultMode: "partial" },
});

export const legacyConfigRules: ChannelDoctorLegacyConfigRule[] = [
  ...webhookMigration.legacyConfigRules,
  ...streamingAliasMigration.legacyConfigRules,
];

export function normalizeHistoricalWebhookConfig({
  cfg,
}: {
  cfg: OmnipolymathConfig;
}): ChannelDoctorConfigMutation {
  const webhook = webhookMigration.normalizeCompatibilityConfig({ cfg });
  return {
    ...webhook,
    historicalWebhookAccountIds:
      cfg.channels?.msteams === undefined && !resolveMSTeamsCredentials()
        ? null
        : cfg.channels?.msteams?.enabled === false
          ? []
          : [undefined],
  };
}

export function normalizeCompatibilityConfig({
  cfg,
}: {
  cfg: OmnipolymathConfig;
}): ChannelDoctorConfigMutation {
  const webhook = normalizeHistoricalWebhookConfig({ cfg });
  return {
    ...streamingAliasMigration.normalizeChannelConfig({
      cfg: webhook.config,
      changes: webhook.changes,
    }),
    historicalWebhookAccountIds: webhook.historicalWebhookAccountIds,
  };
}
