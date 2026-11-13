import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import type { QaChannelAccountConfig, QaChannelConfig } from "./config-schema.js";

export type { QaChannelAccountConfig };

export type CoreConfig = OmnipolymathConfig & {
  channels?: {
    "qa-channel"?: QaChannelConfig;
  };
};

export type ResolvedQaChannelAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
  baseUrl: string;
  botUserId: string;
  botDisplayName: string;
  pollTimeoutMs: number;
  mediaMaxBytes?: number;
  config: QaChannelAccountConfig;
};
