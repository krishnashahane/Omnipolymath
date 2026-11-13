import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import {
  readRuntimeConfig as getRuntimeConfig,
  getRuntimeConfigSourceSnapshot,
} from "omnipolymath/plugin-sdk/runtime-config-snapshot";

export function loadBrowserConfigForRuntimeRefresh(): OmnipolymathConfig {
  return getRuntimeConfigSourceSnapshot() ?? getRuntimeConfig();
}
