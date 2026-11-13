// Private runtime barrel for the bundled Microsoft Teams extension.
// Keep this barrel thin and aligned with the local extension surface.

export { DEFAULT_ACCOUNT_ID } from "omnipolymath/plugin-sdk/account-id";
export { mergeAllowlist, summarizeMapping } from "omnipolymath/plugin-sdk/allow-from";
export type {
  BaseProbeResult,
  ChannelDirectoryEntry,
  ChannelGroupContext,
  ChannelMessageActionName,
  ChannelOutboundAdapter,
} from "omnipolymath/plugin-sdk/channel-contract";
export type { ChannelPlugin } from "omnipolymath/plugin-sdk/channel-core";
export { logTypingFailure } from "omnipolymath/plugin-sdk/channel-outbound";
export { createChannelPairingController } from "omnipolymath/plugin-sdk/channel-pairing";
export { createChannelMessageReplyPipeline } from "omnipolymath/plugin-sdk/channel-outbound";
export {
  PAIRING_APPROVED_MESSAGE,
  buildProbeChannelStatusSummary,
  createDefaultChannelRuntimeState,
} from "omnipolymath/plugin-sdk/channel-status";
export {
  buildChannelKeyCandidates,
  normalizeChannelSlug,
  resolveChannelEntryMatchWithFallback,
  resolveNestedAllowlistDecision,
} from "omnipolymath/plugin-sdk/channel-targets";
export type {
  GroupToolPolicyConfig,
  MSTeamsChannelConfig,
  MSTeamsCloudName,
  MSTeamsConfig,
  MSTeamsReplyStyle,
  MSTeamsTeamConfig,
  MarkdownTableMode,
  OmnipolymathConfig,
} from "omnipolymath/plugin-sdk/config-contracts";
export { isDangerousNameMatchingEnabled } from "omnipolymath/plugin-sdk/dangerous-name-runtime";
export { resolveDefaultGroupPolicy } from "omnipolymath/plugin-sdk/runtime-group-policy";
export {
  detectMime,
  extensionForMime,
  extractOriginalFilename,
  getFileExtension,
} from "omnipolymath/plugin-sdk/media-runtime";
export { resolveChannelMediaMaxBytes } from "omnipolymath/plugin-sdk/account-helpers";
export { loadOutboundMediaFromUrl } from "omnipolymath/plugin-sdk/outbound-media";
// Deprecated media-legacy-projection surface; the re-export stays until the
// compat record's removeAfter window expires (deleted in retirement PR 4).
export { buildMediaPayload } from "omnipolymath/plugin-sdk/reply-payload";
export type { ReplyPayload } from "omnipolymath/plugin-sdk/reply-payload";
export type { PluginRuntime } from "omnipolymath/plugin-sdk/runtime-store";
export type { RuntimeEnv } from "omnipolymath/plugin-sdk/runtime";
export type { SsrFPolicy } from "omnipolymath/plugin-sdk/ssrf-runtime";
export { fetchWithSsrFGuard } from "omnipolymath/plugin-sdk/ssrf-runtime";
export { normalizeStringEntries } from "omnipolymath/plugin-sdk/string-normalization-runtime";
export { chunkTextForOutbound } from "omnipolymath/plugin-sdk/text-chunking";
export { DEFAULT_WEBHOOK_MAX_BODY_BYTES } from "omnipolymath/plugin-sdk/webhook-ingress";
export { setMSTeamsRuntime } from "./src/runtime.js";
