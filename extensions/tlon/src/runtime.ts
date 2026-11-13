import type { PluginRuntime } from "omnipolymath/plugin-sdk/plugin-runtime";
import { createPluginRuntimeStore } from "omnipolymath/plugin-sdk/runtime-store";

const { setRuntime: setTlonRuntime, getRuntime: getTlonRuntime } =
  createPluginRuntimeStore<PluginRuntime>({
    pluginId: "tlon",
    errorMessage: "Tlon runtime not initialized",
  });
export { getTlonRuntime, setTlonRuntime };
