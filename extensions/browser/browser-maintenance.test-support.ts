import { createPluginStateKeyedStoreForTests } from "omnipolymath/plugin-sdk/plugin-state-test-runtime";
import { setRuntimeConfigSnapshot } from "omnipolymath/plugin-sdk/runtime-config-snapshot";
import type { OmnipolymathTestState } from "omnipolymath/plugin-sdk/test-state";

export async function setupMaintenance(state: OmnipolymathTestState, cdpUrl: string) {
  const remote = { driver: "existing-session" as const, cdpUrl };
  const config = { browser: { profiles: { remote } } };
  await state.writeConfig(config);
  setRuntimeConfigSnapshot(config);
  const { initializeBrowserSessionTabStore, getBrowserSessionTabStore } =
    await import("./src/browser/session-tab-store.js");
  initializeBrowserSessionTabStore({
    state: {
      openKeyedStore: (options) => createPluginStateKeyedStoreForTests("browser", options),
    },
  });
  return { config, store: getBrowserSessionTabStore() };
}
