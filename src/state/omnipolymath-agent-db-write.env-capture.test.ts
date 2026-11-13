import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { awaitGateBeforeSettlement } from "../../test/helpers/promise.js";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import type { SqliteIntegrityOperation } from "../infra/sqlite-integrity.js";
import { createDeferredCore } from "../shared/deferred.js";
import { withMockedPlatform } from "../test-utils/vitest-spies.js";
import type {
  OmnipolymathAgentDatabase,
  OmnipolymathAgentDatabaseOptions,
} from "./omnipolymath-agent-db-contract.js";
import type { PendingAgentDatabaseOpen } from "./omnipolymath-agent-db-lifecycle.js";
import { withOmnipolymathAgentDatabaseWrite as writeDatabase } from "./omnipolymath-agent-db-write.js";
import {
  withOmnipolymathAgentDatabaseAdmission as admitDatabase,
  withOmnipolymathAgentDatabaseAsync as useDatabase,
} from "./omnipolymath-agent-db.js";

const boundary = vi.hoisted(() => {
  const controls: { ready: Promise<void>; onIntegrity?: (signal?: AbortSignal) => void } = {
    ready: Promise.resolve(),
  };
  return {
    controls,
    integrity: vi.fn(async (_path: string, _timeout: number, signal?: AbortSignal) => {
      controls.onIntegrity?.(signal);
      await controls.ready;
      signal?.throwIfAborted();
    }),
    cache: {
      terminal: { peek: () => undefined },
      pending: new Map<string, PendingAgentDatabaseOpen>(),
      activePending: new Set<PendingAgentDatabaseOpen>(),
      databases: new Map<string, OmnipolymathAgentDatabase>(),
    },
    route: vi.fn(
      (options: OmnipolymathAgentDatabaseOptions) =>
        options.path ??
        `${options.env?.OMNIPOLYMATH_STATE_DIR ?? "/synthetic/default"}/${options.agentId}.sqlite`,
    ),
    admit: vi.fn(async (_options: OmnipolymathAgentDatabaseOptions, run: () => Promise<unknown>) => {
      await controls.ready;
      return await run();
    }),
    open: vi.fn((_options: OmnipolymathAgentDatabaseOptions) => {}),
  };
});

vi.mock("node:sqlite", () => ({
  DatabaseSync: class {
    readonly isOpen = true;
    constructor(private readonly pathname: string) {}
    location() {
      return this.pathname;
    }
  },
}));
vi.mock("../config/state-dir.js", () => ({
  resolveStateDir: (env: NodeJS.ProcessEnv) => env.OMNIPOLYMATH_STATE_DIR ?? "/synthetic/default",
}));
// mock-isolation: Use a deterministic route to observe the captured environment before admission.
vi.mock("./omnipolymath-agent-db.paths.js", () => ({
  INCOGNITO_AGENT_SQLITE_BASENAME: "incognito-omnipolymath-agent.sqlite",
  resolveOmnipolymathAgentSqlitePath: boundary.route,
}));
// mock-isolation: This fixture tests native one-shot env/admission, not worker discovery.
vi.mock("./omnipolymath-agent-execution.js", () => ({
  supportsOmnipolymathAgentDatabaseExecution: () => false,
}));
// mock-isolation: Capture environment before queued admission without opening real databases.
vi.mock("./omnipolymath-agent-write-admission.js", () => ({
  runOmnipolymathAgentWriteAdmission: boundary.admit,
}));
// mock-isolation: Admission uses the fixture's pending-open cache without real lifecycle state.
vi.mock("./omnipolymath-agent-db-lifecycle.js", () => ({
  agentDatabaseLifecycle: boundary.cache,
}));
// mock-isolation: Synthetic admission owns the handle; this fixture observes borrow release only.
vi.mock("./omnipolymath-agent-db-borrower.js", () => ({ retainAgentDatabase: vi.fn(() => vi.fn()) }));
// mock-isolation: The fixture supplies database admission without opening operator databases.
vi.mock("./agent-database-admission.js", () => ({ assertAgentDatabaseAdmitted: vi.fn() }));
vi.mock("./agent-deletion-cleanup.js", () => ({
  assertAgentDeletionDatabaseCleanupAccess: vi.fn(),
  getAgentDeletionDatabaseCleanup: () => undefined,
}));
vi.mock("./omnipolymath-state-db-async-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./omnipolymath-state-db-async-lifecycle.js")>()),
  getOmnipolymathDatabaseMaintenanceScope: () => undefined,
  observeOmnipolymathDatabaseMaintenanceResource: vi.fn(),
}));
vi.mock("../infra/sqlite-integrity-worker.js", () => ({
  assertSqliteIntegrityInWorker: boundary.integrity,
}));
// mock-isolation: Keep native integrity checks outside this environment-capture fixture.
vi.mock("../infra/sqlite-integrity.js", () => ({ runSqliteIntegrityCheckSync: vi.fn() }));
// mock-isolation: Exercise the admission owner without native database initialization.
vi.mock("./omnipolymath-agent-db.js", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { createSqliteWalReclamationResult } = await import("../infra/sqlite-wal-reclamation.js");
  const { createOmnipolymathAgentDatabaseAdmissionOwner } =
    await import("./omnipolymath-agent-db-admission.js");
  const { registerOmnipolymathAgentDatabaseIdentity } = await import("./omnipolymath-agent-db-identity.js");
  const owner = createOmnipolymathAgentDatabaseAdmissionOwner(function* (
    options: OmnipolymathAgentDatabaseOptions,
  ): SqliteIntegrityOperation<OmnipolymathAgentDatabase> {
    const pathname = boundary.route(options);
    writeFileSync(pathname, "", { flag: "wx" });
    const database = {
      agentId: options.agentId,
      path: pathname,
      db: new DatabaseSync(pathname),
      walMaintenance: {
        stop: async () => {},
        checkpoint: () => false,
        close: () => true,
        reclaimFreePages: createSqliteWalReclamationResult,
      },
    };
    registerOmnipolymathAgentDatabaseIdentity(database.db);
    yield { database: database.db, databaseLabel: database.path };
    boundary.open(options);
    boundary.cache.databases.set(database.path, database);
    return database;
  });
  return { ...owner, getOmnipolymathAgentDatabaseIfOpen: vi.fn() };
});

afterEach(() => {
  expect([boundary.cache.pending.size, boundary.cache.activePending.size]).toEqual([0, 0]);
  boundary.cache.databases.clear();
  boundary.controls.ready = Promise.resolve();
  boundary.controls.onIntegrity = undefined;
  vi.clearAllMocks();
});
const dirs = useAutoCleanupTempDirTracker(afterEach);
const databasePath = (database: OmnipolymathAgentDatabase) => database.path;

it.each([
  { driver: "write", platform: "win32", stateKey: "Omnipolymath_State_Dir", input: "plain" },
  { driver: "write", platform: "win32", stateKey: "Omnipolymath_State_Dir", input: "precloned" },
  { driver: "async", platform: "win32", stateKey: "Omnipolymath_State_Dir", input: "plain" },
  { driver: "admission", platform: "win32", stateKey: "Omnipolymath_State_Dir", input: "plain" },
  { driver: "write", platform: "linux", stateKey: "OMNIPOLYMATH_STATE_DIR", input: "plain" },
] as const)("pins $input environment through $driver capture on $platform", async (fixture) => {
  const originalRoot = dirs.make("agent-db-env-capture-");
  await withMockedPlatform(fixture.platform, async () => {
    const rawEnv = { [fixture.stateKey]: originalRoot };
    const env = fixture.input === "precloned" ? cloneEnvWithPlatformSemantics(rawEnv) : rawEnv;
    const options = { agentId: "main", env };
    const ready = createDeferredCore();
    boundary.controls.ready = ready.promise;
    const mutate = vi.fn(databasePath);
    const write =
      fixture.driver === "write"
        ? writeDatabase(options, mutate)
        : fixture.driver === "async"
          ? useDatabase(options, mutate)
          : admitDatabase(
              options,
              async (run) => {
                await ready.promise;
                return await run(() => {});
              },
              mutate,
            );
    try {
      expect(boundary.route.mock.calls[0]?.[0].env?.OMNIPOLYMATH_STATE_DIR).toBe(originalRoot);
      expect(mutate).not.toHaveBeenCalled();
      if (fixture.driver === "write") {
        expect(boundary.admit.mock.calls[0]?.[0].env?.OMNIPOLYMATH_STATE_DIR).toBe(originalRoot);
        expect(boundary.open).not.toHaveBeenCalled();
      }

      env[fixture.stateKey] = "/synthetic/changed";
      options.env = { OMNIPOLYMATH_STATE_DIR: "/synthetic/replaced" };
      ready.resolve();

      await expect(write).resolves.toBe(`${originalRoot}/main.sqlite`);
      expect(boundary.open.mock.calls[0]?.[0].env?.OMNIPOLYMATH_STATE_DIR).toBe(originalRoot);
      expect(mutate).toHaveBeenCalledOnce();
    } finally {
      ready.resolve();
      await write.catch(() => undefined);
    }
  });
});

it("cancels one coalesced waiter without aborting the shared integrity check", async () => {
  const ready = createDeferredCore();
  const started = createDeferredCore<AbortSignal>();
  boundary.controls.ready = ready.promise;
  boundary.controls.onIntegrity = (signal) => {
    if (!signal) {
      throw new Error("Shared integrity check requires its owner's signal");
    }
    started.resolve(signal);
  };
  const first = vi.fn(databasePath);
  const second = vi.fn(databasePath);
  const options = {
    agentId: "main",
    path: path.join(dirs.make("agent-db-coalesced-capture-"), "coalesced.sqlite"),
  };
  const canceled = new AbortController();
  const stopped = Promise.allSettled([useDatabase(options, first, undefined, canceled.signal)]);
  const remaining = useDatabase(options, second);
  try {
    const physicalSignal = await awaitGateBeforeSettlement(
      started.promise,
      remaining,
      "Database admission settled before its integrity check",
    );
    const reason = new Error("Stop only the first waiter");
    canceled.abort(reason);
    expect(await stopped).toMatchObject([
      { status: "rejected", reason: { name: "AbortError", cause: reason } },
    ]);
    expect(physicalSignal.aborted).toBe(false);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(boundary.open).not.toHaveBeenCalled();
    ready.resolve();
    await expect(remaining).resolves.toBe(options.path);
    expect(second).toHaveBeenCalledOnce();
    expect(boundary.integrity).toHaveBeenCalledOnce();
    expect(boundary.open).toHaveBeenCalledOnce();
  } finally {
    ready.resolve();
    await Promise.allSettled([stopped, remaining]);
  }
});
