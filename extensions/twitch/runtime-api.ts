// Private runtime barrel for the bundled Twitch extension.
// Keep this barrel thin and aligned with the local extension surface.

export type {
  ChannelAccountSnapshot,
  ChannelCapabilities,
  ChannelGatewayContext,
  ChannelLogSink,
  ChannelMessageActionAdapter,
  ChannelMessageActionContext,
  ChannelMeta,
  ChannelOutboundAdapter,
  ChannelOutboundContext,
  ChannelResolveKind,
  ChannelResolveResult,
  ChannelStatusAdapter,
} from "omnipolymath/plugin-sdk/channel-contract";
export type { ChannelPlugin } from "omnipolymath/plugin-sdk/channel-core";
export type { OutboundDeliveryResult } from "omnipolymath/plugin-sdk/channel-send-result";
export type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
export type { RuntimeEnv } from "omnipolymath/plugin-sdk/runtime";
export type { WizardPrompter } from "omnipolymath/plugin-sdk/setup";
