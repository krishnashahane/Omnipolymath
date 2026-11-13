import type { PluginRuntime } from "omnipolymath/plugin-sdk/core";
import { createPluginRuntimeStore } from "omnipolymath/plugin-sdk/runtime-store";

const {
  setRuntime: setSignalRuntime,
  getRuntime: getSignalRuntime,
  tryGetRuntime: getOptionalSignalRuntime,
} = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "signal",
  errorMessage: "Signal runtime not initialized",
});
export { getOptionalSignalRuntime, getSignalRuntime, setSignalRuntime };
