// Keep this barrel thin and generic-only.

export type {
  ChannelGroupContext,
  ChannelMessageActionName,
  ChannelMeta,
  ChannelOutboundAdapter,
  ChannelPlugin,
  HistoryEntry,
  OmnipolymathConfig,
  OmnipolymathPluginApi,
  OutboundIdentity,
  PluginRuntime,
  ReplyPayload,
} from "omnipolymath/plugin-sdk/core";
export type { OmnipolymathConfig as ClawdbotConfig } from "omnipolymath/plugin-sdk/core";
export type RuntimeEnv = {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  exit: (code: number) => void;
};
export {
  evaluateSupplementalContextVisibility,
  resolveChannelContextVisibilityMode,
} from "omnipolymath/plugin-sdk/context-visibility-runtime";
export { normalizeAgentId } from "omnipolymath/plugin-sdk/routing";
export { setFeishuRuntime } from "./src/runtime.js";
