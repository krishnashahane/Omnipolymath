import type {
  BuildChannelInboundEventContextParams,
  BuiltChannelInboundEventContext,
  ChannelInboundTurnPlan,
} from "omnipolymath/plugin-sdk/channel-inbound";
import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";

export type DiscordConfig = NonNullable<OmnipolymathConfig["channels"]>["discord"];
export type DiscordDispatchReplyFromConfig = NonNullable<
  ChannelInboundTurnPlan["dispatchReplyFromConfig"]
>;

export type DiscordBuildInboundContext = (
  params: BuildChannelInboundEventContextParams,
) => BuiltChannelInboundEventContext | Promise<BuiltChannelInboundEventContext>;
