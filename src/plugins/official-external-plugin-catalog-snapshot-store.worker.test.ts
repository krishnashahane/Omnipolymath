import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { resolveOmnipolymathStateSqlitePath } from "../state/omnipolymath-state-db.paths.js";
import * as workerContext from "../state/omnipolymath-state-worker-context.js";
import { observeMainThreadSql } from "../test-utils/main-thread-sql-spies.test-support.js";
import { withOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";
import { mockProcessPlatform } from "../test-utils/vitest-spies.js";
import { createSqliteHostedOfficialExternalPluginCatalogSnapshotStore as createStore } from "./official-external-plugin-catalog-snapshot-store.js";
import { loadConfiguredHostedOfficialExternalPluginCatalogEntries } from "./official-external-plugin-catalog.js";
import { hostedCatalogFeed } from "./official-external-plugin-catalog.test-support.js";

const url = "https://catalog.example.test/feed";
function makeSnapshot(body = "{}") {
  const checksum = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  return {
    body,
    metadata: { url, status: 200, checksum },
    savedAt: "2026-09-16T00:00:00.000Z",
  };
}
afterEach(() => vi.restoreAllMocks());

it("captures Windows environment semantics and explicit state-directory overrides per operation", async () => {
  const captureContext = workerContext.captureOmnipolymathStateWorkerContext;
  const captured: { context: ReturnType<typeof captureContext>; env?: NodeJS.ProcessEnv }[] = [];
  const stopped = new Error("stop after the actual producer captures its context");
  vi.spyOn(workerContext, "captureOmnipolymathStateWorkerContext").mockImplementation(
    (options = {}) => {
      captured.push({ context: captureContext(options), env: options.env });
      throw stopped;
    },
  );
  mockProcessPlatform("win32");
  const initialRoot = path.resolve("synthetic-initial-state");
  const firstRoot = path.resolve("synthetic-first-state");
  const laterRoot = path.resolve("synthetic-later-state");
  const env = { omnipolymath_state_dir: initialRoot, omnipolymath_supervisor_mode: "external" };
  const options = { env, stateDir: firstRoot, stateDatabasePath: path.resolve("catalog.sqlite") };
  const store = createStore(options);
  const snapshot = makeSnapshot();
  await expect(store.write(snapshot)).rejects.toBe(stopped);
  expect(captured[0]?.context.environment).toEqual({
    OMNIPOLYMATH_STATE_DIR: firstRoot,
    OMNIPOLYMATH_SUPERVISOR_MODE: "external",
  });
  expect(
    Object.keys(captured[0]?.env ?? {}).filter((key) => key.toUpperCase() === "OMNIPOLYMATH_STATE_DIR"),
  ).toHaveLength(1);
  expect(env.omnipolymath_state_dir).toBe(initialRoot);

  options.stateDir = laterRoot;
  env.omnipolymath_supervisor_mode = "internal";
  await expect(store.write(snapshot)).rejects.toBe(stopped);
  expect(captured[1]?.context.environment).toEqual({ OMNIPOLYMATH_STATE_DIR: laterRoot });
  expect(captured[0]?.context.environment.OMNIPOLYMATH_SUPERVISOR_MODE).toBe("external");
});

it("persists snapshots and serves the offline catalog without parent SQL", () =>
  withOmnipolymathTestState({ label: "hosted-catalog-worker" }, async (state) => {
    const options = { env: { ...state.env } };
    const store = createStore(options);
    const feed = hostedCatalogFeed({ sequence: 1, pluginName: "@fixture/catalog-worker" });
    const body = JSON.stringify(feed);
    const snapshot = makeSnapshot(body);
    requireNodeSqlite();
    const sql = observeMainThreadSql();
    sql.calibrate();

    await expect(store.read(url)).resolves.toBeNull();
    expect(existsSync(resolveOmnipolymathStateSqlitePath(state.env))).toBe(false);
    const pending = store.write(snapshot);
    options.env.OMNIPOLYMATH_STATE_DIR = state.path("later-state");
    await pending;

    const loaded = await loadConfiguredHostedOfficialExternalPluginCatalogEntries({
      env: state.env,
      offline: true,
      feedProfile: "fixture",
      catalogConfig: {
        feeds: { fixture: { url, feedId: feed.id } },
        sources: { "acme-npm": { type: "npm", registry: "https://catalog.example.test/npm" } },
      },
    });
    expect(loaded).toMatchObject({
      source: "hosted-snapshot",
      entries: [{ name: "@fixture/catalog-worker" }],
      snapshot: { body, metadata: { url } },
    });
    await expect(store.read(url)).resolves.toBeNull();
    expect(existsSync(resolveOmnipolymathStateSqlitePath(options.env))).toBe(false);
    sql.expectIdle();
  }));
