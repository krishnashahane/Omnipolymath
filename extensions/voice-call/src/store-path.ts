import os from "node:os";
import path from "node:path";
import { resolvePluginConfigObject } from "omnipolymath/plugin-sdk/plugin-config-runtime";
import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/plugin-entry";
import { resolveStateDir } from "omnipolymath/plugin-sdk/state-paths";
import { resolveUserPath } from "./utils.js";

/** Resolve the plugin-owned store below Omnipolymath's canonical state directory. */
export function resolveDefaultVoiceCallStoreDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "voice-calls");
}

/** Read the configured voice-call store path from either package id. */
function getVoiceCallConfigStore(config: OmnipolymathConfig): string {
  for (const pluginId of ["voice-call", "@omnipolymath/voice-call"]) {
    const store = resolvePluginConfigObject(config, pluginId)?.store;
    if (typeof store === "string" && store.trim()) {
      return store.trim();
    }
  }
  return "";
}

/** Resolve the voice-call store path used by legacy and plugin-state call records. */
export function resolveVoiceCallStorePath(params: {
  config: OmnipolymathConfig;
  env: NodeJS.ProcessEnv;
}): string {
  const configuredStore = getVoiceCallConfigStore(params.config);
  if (configuredStore) {
    return resolveUserPath(configuredStore, () => params.env.HOME?.trim() || os.homedir());
  }
  return resolveDefaultVoiceCallStoreDir(params.env);
}
