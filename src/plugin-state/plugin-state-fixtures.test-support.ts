import { afterAll, afterEach, beforeAll, beforeEach, it, vi } from "vitest";
import * as stateRead from "../state/omnipolymath-state-db-readonly.js";
import {
  createOmnipolymathTestState,
  withOmnipolymathTestState,
  type OmnipolymathTestState,
} from "../test-utils/omnipolymath-test-state.js";
import * as namespaceOwner from "./plugin-state-namespace-owner.js";
import {
  createPluginStateKeyedStore,
  createPluginStateSyncKeyedStore,
  resetPluginStateStoreForTests,
  type OpenKeyedStoreOptions,
} from "./plugin-state-store.js";
import { clearPluginStateStoreForTests } from "./plugin-state-store.test-helpers.js";

export function observePluginStateReads(onLoaded?: () => void | Promise<void>) {
  const reads = vi.fn<() => void>();
  const ensureNamespace = namespaceOwner.ensurePluginStateNamespace;
  const executeRead = stateRead.executeExistingOmnipolymathStateRead;
  vi.spyOn(namespaceOwner, "ensurePluginStateNamespace").mockImplementation(
    (identity, scope, load) =>
      ensureNamespace(identity, scope, async (maxBytes) => {
        reads();
        const rows = await load(maxBytes);
        await onLoaded?.();
        return rows;
      }),
  );
  vi.spyOn(stateRead, "executeExistingOmnipolymathStateRead").mockImplementation((...args) => {
    reads();
    return executeRead(...args);
  });
  return reads;
}

export function keyedStores<T>(pluginId: string, options: OpenKeyedStoreOptions) {
  return {
    store: createPluginStateKeyedStore<T>(pluginId, options),
    sync: createPluginStateSyncKeyedStore<T>(pluginId, options),
  };
}

export function keyedStore<T>(
  pluginId: string,
  namespace: string,
  options: Partial<OpenKeyedStoreOptions> = {},
) {
  return createPluginStateKeyedStore<T>(pluginId, { maxEntries: 10, ...options, namespace });
}

export function syncKeyedStore<T>(
  pluginId: string,
  namespace: string,
  options: Partial<OpenKeyedStoreOptions> = {},
) {
  return createPluginStateSyncKeyedStore<T>(pluginId, { maxEntries: 10, ...options, namespace });
}

export function stateTest(label: string, applyEnv = true) {
  return it.extend<{ state: OmnipolymathTestState }>({
    state: async ({ task }, use) => {
      await withOmnipolymathTestState({ label: `${label}-${task.id}`, applyEnv }, use);
    },
  });
}

export function useState(label: string, clear = true, closeBetween = false) {
  let state: OmnipolymathTestState;
  beforeAll(async () => {
    state = await createOmnipolymathTestState({ label });
  });
  beforeEach(() => {
    state.applyEnv();
    if (clear) {
      clearPluginStateStoreForTests();
    }
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetPluginStateStoreForTests({ closeDatabase: closeBetween });
  });
  afterAll(async () => {
    resetPluginStateStoreForTests();
    await state.cleanup();
  });
  return () => state;
}
