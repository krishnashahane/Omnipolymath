import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/memory-core-host-runtime-core";
import { setRuntimeConfigSnapshot } from "omnipolymath/plugin-sdk/runtime-config-snapshot";
import { createOmnipolymathTestState } from "omnipolymath/plugin-sdk/test-state";
import { afterAll, beforeAll } from "vitest";
import { postgresProductScope } from "../postgres-product.test-support.js";
import {
  configureMemoryCoreDreamingStateForTests,
  resetMemoryCoreDreamingStateForTests,
} from "../test-helpers.js";
import { closeAllMemorySearchManagers } from "./index.js";

export function createPostgresIndexFixture(
  name: string,
  engine: "sqlite" | "postgres",
  configure: (workspace: string) => OmnipolymathConfig,
) {
  const database = postgresProductScope(name);
  const unavailable = engine === "postgres" && !database.connection;
  let state: Awaited<ReturnType<typeof createOmnipolymathTestState>> | undefined;
  let config: OmnipolymathConfig;
  let run = AsyncLocalStorage.snapshot();
  let connected = false;
  beforeAll(async () => {
    if (unavailable) {
      return;
    }
    state = await createOmnipolymathTestState({ label: `${name}-${engine}`, layout: "state-only" });
    await configureMemoryCoreDreamingStateForTests();
    if (engine === "postgres") {
      await database.connect();
      connected = true;
    }
    config = configure(state.workspaceDir);
    setRuntimeConfigSnapshot(config);
    run = database.select(() => AsyncLocalStorage.snapshot(), config);
  });
  afterAll(async () => {
    try {
      await run(async () => {
        await closeAllMemorySearchManagers();
        resetMemoryCoreDreamingStateForTests();
        await state?.cleanup();
      });
    } finally {
      if (connected) {
        await database.close();
      }
    }
  });
  return {
    unavailable,
    get config() {
      return config;
    },
    get workspace() {
      assert(state);
      return state.workspaceDir;
    },
    run: <T>(callback: () => T) => run(callback),
  };
}
