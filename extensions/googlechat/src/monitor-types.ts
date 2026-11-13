import type { ChannelAccountSnapshot } from "omnipolymath/plugin-sdk/channel-contract";
import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/core";
import type { ResolvedGoogleChatAccount } from "./accounts.js";
import type { GoogleChatAudienceType } from "./auth.js";
import type { GoogleChatIngressMonitor } from "./monitor-ingress.js";
import type { getGoogleChatRuntime } from "./runtime.js";

export type GoogleChatRuntimeEnv = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

type GoogleChatStatusSink = (patch: Partial<ChannelAccountSnapshot>) => void;

export type GoogleChatMonitorOptions = {
  account: ResolvedGoogleChatAccount;
  config: OmnipolymathConfig;
  runtime: GoogleChatRuntimeEnv;
  abortSignal: AbortSignal;
  webhookPath?: string;
  webhookUrl?: string;
  statusSink?: GoogleChatStatusSink;
};

export type GoogleChatCoreRuntime = ReturnType<typeof getGoogleChatRuntime>;

export type WebhookTarget = {
  account: ResolvedGoogleChatAccount;
  config: OmnipolymathConfig;
  runtime: GoogleChatRuntimeEnv;
  core: GoogleChatCoreRuntime;
  path: string;
  audienceType?: GoogleChatAudienceType;
  audience?: string;
  statusSink?: GoogleChatStatusSink;
  mediaMaxMb: number;
  ingress: Pick<GoogleChatIngressMonitor, "receive">;
};
