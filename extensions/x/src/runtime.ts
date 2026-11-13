import type { PluginRuntime } from "omnipolymath/plugin-sdk/core";
import { createPluginRuntimeStore } from "omnipolymath/plugin-sdk/runtime-store";

const store = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "x",
  errorMessage: "X runtime not initialized",
});
export const getXRuntime = store.getRuntime;
export const setXRuntime = store.setRuntime;
