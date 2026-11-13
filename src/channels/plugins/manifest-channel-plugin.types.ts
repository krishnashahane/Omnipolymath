import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import type { ChannelConfigSchema } from "./types.config.js";

type ManifestChannelAccount = {
  accountId: string;
  name?: string;
  config: Record<string, unknown>;
};

/** Metadata adapters expose account inspection without loading channel runtime contracts. */
export type ManifestChannelPlugin = {
  id: string;
  meta: {
    id: string;
    label: string;
    selectionLabel: string;
    detailLabel?: string;
    systemImage?: string;
    docsPath: string;
    blurb: string;
    preferOver?: readonly string[];
  };
  capabilities: { chatTypes: ["direct"] };
  commands?: {
    nativeCommandsAutoEnabled?: boolean;
    nativeSkillsAutoEnabled?: boolean;
  };
  configSchema?: ChannelConfigSchema;
  config: {
    listAccountIds: (cfg: OmnipolymathConfig) => string[];
    defaultAccountId: (cfg: OmnipolymathConfig) => string;
    resolveAccount: (cfg: OmnipolymathConfig, accountId?: string | null) => ManifestChannelAccount;
    isEnabled: (account: ManifestChannelAccount, cfg: OmnipolymathConfig) => boolean;
    isConfigured: (account: ManifestChannelAccount, cfg: OmnipolymathConfig) => boolean;
    hasConfiguredState: (params: { cfg: OmnipolymathConfig; env?: NodeJS.ProcessEnv }) => boolean;
  };
};
