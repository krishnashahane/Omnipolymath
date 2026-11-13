import type { PluginRuntime } from "omnipolymath/plugin-sdk/channel-core";
import { createPluginRuntimeStore } from "omnipolymath/plugin-sdk/runtime-store";

const {
  setRuntime: setSlackRuntime,
  tryGetRuntime: getOptionalSlackRuntime,
  getRuntime: getSlackRuntime,
} = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "slack",
  errorMessage: "Slack runtime not initialized",
});
export { getOptionalSlackRuntime, getSlackRuntime, setSlackRuntime };
