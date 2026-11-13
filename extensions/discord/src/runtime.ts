import type { PluginRuntime } from "omnipolymath/plugin-sdk/channel-core";
import { createPluginRuntimeStore } from "omnipolymath/plugin-sdk/runtime-store";

export const {
  setRuntime: setDiscordRuntime,
  tryGetRuntime: getOptionalDiscordRuntime,
  getRuntime: getDiscordRuntime,
} = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "discord",
  errorMessage: "Discord runtime not initialized",
});
