import type {
  ChannelAccountSnapshot,
  ChannelRuntimeSurface,
} from "omnipolymath/plugin-sdk/channel-contract";
import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import type { RuntimeEnv } from "omnipolymath/plugin-sdk/runtime-env";
import type { TelegramBotInfo } from "./bot-info.js";

export type MonitorTelegramOpts = {
  token?: string;
  accountId?: string;
  ownerAgentId?: string;
  config?: OmnipolymathConfig;
  runtime?: RuntimeEnv;
  channelRuntime?: ChannelRuntimeSurface;
  abortSignal?: AbortSignal;
  useWebhook?: boolean;
  webhookPath?: string;
  legacyWebhook?: false | { port: number; host?: string };
  webhookSecret?: string;
  proxyFetch?: typeof fetch;
  webhookUrl?: string;
  webhookCertPath?: string;
  botInfo?: TelegramBotInfo;
  setStatus?: (patch: Omit<ChannelAccountSnapshot, "accountId">) => void;
};
