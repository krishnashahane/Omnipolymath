import type { OmnipolymathPluginApi } from "omnipolymath/plugin-sdk/plugin-entry";

export {
  buildPluginConfigSchema,
  definePluginEntry,
  type AnyAgentTool,
  type OmnipolymathPluginApi,
  type OmnipolymathPluginToolContext,
  type PluginLogger,
} from "omnipolymath/plugin-sdk/plugin-entry";
export type { PluginStateKeyedStore } from "omnipolymath/plugin-sdk/plugin-state-runtime";
export { createPluginRuntimeStore, type PluginRuntime } from "omnipolymath/plugin-sdk/runtime-store";

export type PluginGatewayAccessAuthority = NonNullable<
  ReturnType<Parameters<OmnipolymathPluginApi["registerGatewayAccessPolicy"]>[0]["authorize"]>
>;
