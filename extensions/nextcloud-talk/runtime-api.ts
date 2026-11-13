// Private runtime barrel for the bundled Nextcloud Talk extension.
// Keep this barrel thin and aligned with the local extension surface.

export type { AllowlistMatch } from "omnipolymath/plugin-sdk/allow-from";
export type { ChannelGroupContext } from "omnipolymath/plugin-sdk/channel-contract";
export { logInboundDrop } from "omnipolymath/plugin-sdk/channel-inbound";
export { createChannelPairingController } from "omnipolymath/plugin-sdk/channel-pairing";
export type {
  GroupPolicy,
  GroupToolPolicyConfig,
  OmnipolymathConfig,
} from "omnipolymath/plugin-sdk/config-contracts";
export {
  GROUP_POLICY_BLOCKED_LABEL,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  warnMissingProviderGroupPolicyFallbackOnce,
} from "omnipolymath/plugin-sdk/runtime-group-policy";
export type { OutboundReplyPayload } from "omnipolymath/plugin-sdk/reply-payload";
export type { PluginRuntime } from "omnipolymath/plugin-sdk/runtime-store";
export type { RuntimeEnv } from "omnipolymath/plugin-sdk/runtime";
export { fetchWithSsrFGuard } from "omnipolymath/plugin-sdk/ssrf-runtime";
export { setNextcloudTalkRuntime } from "./src/runtime.js";
