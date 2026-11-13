import type { PluginRuntime } from "omnipolymath/plugin-sdk/core";
import { createPluginRuntimeStore } from "omnipolymath/plugin-sdk/runtime-store";

const { setRuntime: setLineRuntime, getRuntime: getLineRuntime } =
  createPluginRuntimeStore<PluginRuntime>({
    pluginId: "line",
    errorMessage: "LINE runtime not initialized - plugin not registered",
  });
export { getLineRuntime, setLineRuntime };
