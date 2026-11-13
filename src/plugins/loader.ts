/** Stable public facade for plugin loading and runtime-registry resolution. */
import { loadOmnipolymathPlugins } from "./loader-runtime-load.js";
import type { PluginLoadOptions } from "./loader-types.js";
export { resolveCompatibleRuntimePluginRegistry } from "./active-runtime-registry.js";
export {
  clearPluginRegistryLoadCache,
  isPluginRegistryLoadInFlight,
  resolvePluginRegistryLoadCacheKey,
} from "./loader-cache.js";
export {
  resolveRuntimePluginRegistry,
  acquirePluginRegistryForInspection,
  loadAndActivateRootPluginRegistry,
  loadOmnipolymathPluginsAsync,
} from "./loader-runtime-load.js";

/** Loads a caller-owned registry value without changing the process-wide active registry. */
export function loadPluginRegistryHandle(options: PluginLoadOptions = {}) {
  return loadOmnipolymathPlugins({ ...options, activate: false });
}

/** Collects CLI descriptors through the same validation and instance owner as runtime loading. */
export async function loadOmnipolymathPluginCliRegistry(options: PluginLoadOptions = {}) {
  return loadOmnipolymathPlugins({
    ...options,
    mode: "cli-metadata",
    activate: false,
  });
}

export { loadOmnipolymathPlugins };
export type { PluginLoadOptions };
