import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { isRecord } from "@omnipolymath/normalization-core/record-coerce";
import { afterEach, expect, it, vi } from "vitest";
import * as backoff from "../infra/backoff.js";
import * as nodeSqlite from "../infra/node-sqlite.js";
import { runtimeProcessEntrypoints } from "../infra/runtime-process-entrypoints.js";
import { withRuntimeWorkerGeneration } from "../infra/runtime-worker-generation.js";
import { resolveRuntimeWorkerUrl } from "../infra/runtime-worker-url.js";
import { readSqliteBusyTimeout } from "../infra/sqlite-busy-timeout.js";
import { createWarnLogCapture } from "../logging/test-helpers/warn-log-capture.js";
import { withProjectCheckoutLifecycle } from "../projects/project-checkout.js";
import { requireNativeSqliteDatabase } from "../test-utils/native-sqlite.js";
import { withOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";
import { acquireClawPackageLifecycleLease } from "./claw-package-lifecycle-lease.js";
import { withAgentDatabaseMaintenanceLease } from "./omnipolymath-agent-db-maintenance-lease.js";
import {
  createOmnipolymathDatabaseMaintenanceScope,
  StateDatabaseReadAdmissionInvalidatedError,
} from "./omnipolymath-state-db-async-lifecycle.js";
import {
  OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS,
  OMNIPOLYMATH_STATE_SCHEMA_VERSION,
} from "./omnipolymath-state-db-contract.js";
import * as stateDatabaseOpen from "./omnipolymath-state-db-open.js";
import { CONTENT_VERSION_KEY } from "./omnipolymath-state-db-schema-version.js";
import {
  closeOmnipolymathStateDatabaseForTest,
  openOmnipolymathStateDatabase,
  registerOmnipolymathStateDatabaseLifecycleListener,
  runOmnipolymathStateWriteTransaction,
} from "./omnipolymath-state-db.js";
import { resolveOmnipolymathStateSqlitePath } from "./omnipolymath-state-db.paths.js";
import { OmnipolymathStateLeaseAcquisitionError } from "./omnipolymath-state-lease-error.js";
import type { OmnipolymathStateLeaseOptions } from "./omnipolymath-state-lease-options.js";
import * as leaseStore from "./omnipolymath-state-lease-store.js";
import * as leaseStorage from "./omnipolymath-state-lease-worker-storage.js";
import { withOmnipolymathStateLease, type OmnipolymathStateLeaseContext } from "./omnipolymath-state-lease.js";
import * as workerContext from "./omnipolymath-state-worker-context.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  closeOmnipolymathStateDatabaseForTest();
});

function controlElapsedTime() {
  const now = performance.now.bind(performance);
  let elapsedMs = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now() + elapsedMs);
  return (milliseconds: number) => {
    elapsedMs += milliseconds;
  };
}

function leaseOptions(
  env: NodeJS.ProcessEnv,
  key: string,
  overrides: Partial<OmnipolymathStateLeaseOptions> = {},
): OmnipolymathStateLeaseOptions {
  return {
    scope: "core:test",
    key,
    database: { scope: "shared", options: { env } },
    leaseMs: 60_000,
    waitMs: 5_000,
    ...overrides,
  };
}

it("names the checkout operation holding up foreground preparation", async () => {
  await withOmnipolymathTestState({ label: "checkout-owner" }, async ({ env }) => {
    const capture = createWarnLogCapture("checkout-owner");
    const abort = new AbortController();
    vi.spyOn(backoff, "sleepWithAbort").mockImplementation(async () => abort.abort());
    try {
      await withProjectCheckoutLifecycle(
        "synthetic-project",
        { env, operation: "worktree.maintenance.retire" },
        async () => {
          await expect(
            withProjectCheckoutLifecycle(
              "synthetic-project",
              { env, signal: abort.signal },
              async () => {},
            ),
          ).rejects.toMatchObject({ code: "OMNIPOLYMATH_STATE_LEASE_ABORTED" });
          expect(await capture.findText("Waiting for project checkout lease")).toMatch(
            /projects\.checkout\/synthetic-project held by worktree\.maintenance\.retire:[0-9a-f-]+; current lease expires at /,
          );
        },
      );
    } finally {
      capture.cleanup();
    }
  });
});

it.each([false, true])(
  "records an uncoded native open failure during acquisition (prepare: %s)",
  async (prepareDatabase) => {
    await withOmnipolymathTestState({ label: "lease-native-open-failure" }, async (state) => {
      const failure = new Error("native SQLite open unavailable");
      const open = nodeSqlite.openNodeSqliteDatabase;
      const pathname = resolveOmnipolymathStateSqlitePath(state.env);
      vi.spyOn(nodeSqlite, "openNodeSqliteDatabase").mockImplementation((location, options) => {
        if (location === pathname) {
          throw failure;
        }
        return open(location, options);
      });
      const run = vi.fn(async () => undefined);
      await expect(
        withOmnipolymathStateLease(
          leaseOptions(state.env, "native-open-failure", { prepareDatabase }),
          run,
        ),
      ).rejects.toMatchObject({
        outcome: { kind: "store-unavailable", reason: "storage-error" },
        cause: failure,
      });
      expect(run).not.toHaveBeenCalled();
    });
  },
);

it("rebinds the real shared-state lease worker and joins its retained generation", async () => {
  await withOmnipolymathTestState({ label: "lease-retained-worker-generation" }, async (state) => {
    const options = leaseOptions(state.env, "retained-generation", { waitMs: 0 });
    await withOmnipolymathStateLease(options, async (lease) => lease.assertOwned());
    const source = resolveRuntimeWorkerUrl(runtimeProcessEntrypoints.sharedStateStore);
    const retainedPath = path.join(
      path.dirname(resolveOmnipolymathStateSqlitePath(state.env)),
      "retained-state-worker.mts",
    );
    await fs.promises.writeFile(retainedPath, `export * from ${JSON.stringify(source.href)};\n`);
    const retained = pathToFileURL(await fs.promises.realpath(retainedPath));
    const dispatch = vi.spyOn(Worker.prototype, "postMessage");
    const { worker: retainedWorker, exited } = await withRuntimeWorkerGeneration(
      async (bind) => {
        bind((url) => (url.href === source.href ? retained : url));
        await withOmnipolymathStateLease(options, async (lease) => lease.assertOwned());
        const openIndex = dispatch.mock.calls.findIndex(
          ([request]) =>
            isRecord(request) && request.type === "open" && request.moduleUrl === retained.href,
        );
        const worker = dispatch.mock.contexts[openIndex];
        if (!(worker instanceof Worker)) {
          throw new Error("Expected the retained shared-state worker");
        }
        return { worker, exited: once(worker, "exit") };
      },
      async () => {},
    );
    expect(retainedWorker.threadId).toBe(-1);
    await exited;
    await withOmnipolymathStateLease(options, async (lease) => lease.assertOwned());
  });
});

it("passes the exact persisted owner identity to the lease callback", async () => {
  await withOmnipolymathTestState({ label: "lease-callback-identity" }, async (state) => {
    await withOmnipolymathStateLease(
      leaseOptions(state.env, "callback-identity"),
      async (lease, identity) => {
        lease.assertOwned();
        expect(identity).toMatchObject({ scope: "core:test", key: "callback-identity" });
        const database = openOmnipolymathStateDatabase({ env: state.env });
        expect(leaseStore.readOmnipolymathStateLeaseExpiry(database.db, identity)).toBeGreaterThan(
          Date.now(),
        );
        expect(
          leaseStore.readOmnipolymathStateLeaseExpiry(database.db, {
            ...identity,
            owner: "not-the-lease-owner",
          }),
        ).toBeUndefined();
      },
    );
  });
});

it("holds an exact Template package owner until async release completes", async () => {
  await withOmnipolymathTestState({ label: "claw-package-lease-owner" }, async (state) => {
    const artifact = { kind: "plugin", source: "clawhub", ref: "sample/plugin" } as const;
    const options = { env: state.env, required: true };
    const lease = await acquireClawPackageLifecycleLease(artifact, options);
    if (!lease) {
      throw new Error("Expected the package lease to be acquired");
    }
    try {
      lease.assertCurrent();
      const database = openOmnipolymathStateDatabase({ env: state.env });
      expect(leaseStore.readOmnipolymathStateLeaseExpiry(database.db, lease.identity)).toBeGreaterThan(
        Date.now(),
      );
      expect(
        leaseStore.readOmnipolymathStateLeaseExpiry(database.db, {
          ...lease.identity,
          owner: "not-the-package-owner",
        }),
      ).toBeUndefined();
      await expect(acquireClawPackageLifecycleLease(artifact, options)).rejects.toThrow();
    } finally {
      await lease.release();
    }
    const next = await acquireClawPackageLifecycleLease(artifact, options);
    if (!next) {
      throw new Error("Expected the released package lease to be reacquired");
    }
    expect(next.identity.owner).not.toBe(lease.identity.owner);
    await next.release();
  });
});

it.each([
  { stage: "preparation", prepareDatabase: false },
  { stage: "preparation", prepareDatabase: true },
  { stage: "worker", prepareDatabase: false },
] as const)(
  "preserves caller authority refusal at $stage (prepare: $prepareDatabase)",
  async ({ stage, prepareDatabase }) => {
    await withOmnipolymathTestState({ label: "lease-preparation-refusal" }, async (state) => {
      const database =
        stage === "worker" ? openOmnipolymathStateDatabase({ env: state.env }) : undefined;
      const refusal =
        stage === "worker"
          ? new StateDatabaseReadAdmissionInvalidatedError("original authority refusal")
          : Object.assign(new Error("caller authority refused"), { code: "SQLITE_IOERR" });
      const scope = createOmnipolymathDatabaseMaintenanceScope();
      const nativeOpen = vi.spyOn(nodeSqlite, "openNodeSqliteDatabase");
      const run = vi.fn(async () => undefined);
      if (stage === "worker") {
        const capture = workerContext.captureOmnipolymathStateWorkerContext;
        vi.spyOn(workerContext, "captureOmnipolymathStateWorkerContext").mockImplementation(
          (options) => {
            const context = capture(options);
            context.admission = {
              ...context.admission,
              assertCurrent() {
                throw refusal;
              },
            };
            return context;
          },
        );
      }
      try {
        const acquire = () => {
          if (stage === "preparation") {
            vi.spyOn(scope, "assertAdmission").mockImplementation(() => {
              throw refusal;
            });
          }
          return withOmnipolymathStateLease(
            leaseOptions(state.env, "preparation-refusal", {
              prepareDatabase,
              waitMs: stage === "worker" ? 0 : 5_000,
            }),
            run,
          );
        };
        await expect(stage === "preparation" ? scope.run(acquire) : acquire()).rejects.toBe(
          refusal,
        );
        if (database) {
          expect(database.db.prepare("SELECT * FROM state_leases").all()).toEqual([]);
        } else {
          expect(nativeOpen).not.toHaveBeenCalled();
        }
        expect(run).not.toHaveBeenCalled();
      } finally {
        await scope.close();
      }
    });
  },
);

it.each(["maintenance", "generic", "cancelled"] as const)(
  "settles %s work after slow database preparation",
  async (caller) => {
    await withOmnipolymathTestState({ label: "lease-cold-admission" }, async (state) => {
      const advance = controlElapsedTime();
      const controller = new AbortController();
      const clock =
        caller === "cancelled" ? vi.spyOn(performance, "now").mockReturnValue(1_000) : undefined;
      const open = stateDatabaseOpen.openUnpublishedStateDatabase;
      const physicalOpen = vi
        .spyOn(stateDatabaseOpen, "openUnpublishedStateDatabase")
        .mockImplementation((options) => {
          const database = open(options);
          // Keep initialization and ownership real; only its elapsed cost is simulated.
          if (clock) {
            clock.mockReturnValue(2_500);
            controller.abort(new Error("cancel preparation"));
            clock.mockReturnValue(9_000);
          } else {
            advance(6_000);
          }
          return database;
        });
      const run = vi.fn(async (lease: OmnipolymathStateLeaseContext) => lease.assertOwned());
      const operation =
        caller === "maintenance"
          ? withAgentDatabaseMaintenanceLease({ env: state.env }, run)
          : withOmnipolymathStateLease(
              leaseOptions(
                state.env,
                "cold-admission",
                caller === "cancelled" ? { prepareDatabase: true, signal: controller.signal } : {},
              ),
              run,
            );
      if (caller === "cancelled") {
        await expect(operation).rejects.toMatchObject({
          code: "OMNIPOLYMATH_STATE_LEASE_ABORTED",
          outcome: { kind: "aborted", reason: "caller-signal", elapsedMs: 1_500 },
          cause: controller.signal.reason,
        });
        expect(run).not.toHaveBeenCalled();
      } else {
        await operation;
        expect(run).toHaveBeenCalledOnce();
      }
      expect(physicalOpen).toHaveBeenCalled();
      expect(
        openOmnipolymathStateDatabase({ env: state.env })
          .db.prepare("SELECT * FROM state_leases")
          .all(),
      ).toEqual([]);
    });
  },
);

it("records unavailable storage when a native SQLite writer prevents observing a held lease", async () => {
  await withOmnipolymathTestState({ label: "lease-preparation-contention" }, async (state) => {
    const database = openOmnipolymathStateDatabase({ env: state.env });
    const identity = { scope: "core:test", key: "preparation-contention", owner: "other-process" };
    runOmnipolymathStateWriteTransaction(
      ({ db }) => leaseStore.acquireOmnipolymathStateLeaseInTransaction(db, identity, 60_000),
      { env: state.env },
    );
    closeOmnipolymathStateDatabaseForTest();
    const writer = new DatabaseSync(database.path);
    writer.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
    const run = vi.fn(async () => undefined);
    try {
      await expect(
        withOmnipolymathStateLease(
          leaseOptions(state.env, identity.key, { prepareDatabase: true }),
          run,
        ),
      ).rejects.toMatchObject({
        code: "OMNIPOLYMATH_STATE_LEASE_STORAGE_FAILED",
        outcome: { kind: "store-unavailable", reason: "sqlite-busy" },
      });
      expect(run).not.toHaveBeenCalled();
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
    }
    expect(
      openOmnipolymathStateDatabase({ env: state.env })
        .db.prepare("SELECT owner FROM state_leases WHERE scope = ? AND lease_key = ?")
        .get(identity.scope, identity.key),
    ).toMatchObject({ owner: identity.owner });
  });
});

it.each(["acquired", "held", "store-unavailable"] as const)(
  "records cancellation while awaiting an acquisition that settles as %s",
  async (outcome) => {
    await withOmnipolymathTestState({ label: "lease-aborted-after-grant" }, async (state) => {
      const database = openOmnipolymathStateDatabase({ env: state.env });
      const identity = { scope: "core:test", key: "aborted-after-grant", owner: "other-owner" };
      if (outcome === "held") {
        runOmnipolymathStateWriteTransaction(
          ({ db }) => leaseStore.acquireOmnipolymathStateLeaseInTransaction(db, identity, 60_000),
          { env: state.env },
        );
      }
      const writer = outcome === "store-unavailable" ? new DatabaseSync(database.path) : undefined;
      writer?.exec("BEGIN IMMEDIATE");
      const controller = new AbortController();
      const acquire = leaseStorage.acquireLease;
      vi.spyOn(leaseStorage, "acquireLease").mockImplementation(async (...args) => {
        try {
          const result = await acquire(...args);
          expect(result.kind).toBe(outcome);
          return result;
        } catch (error) {
          expect(outcome).toBe("store-unavailable");
          expect(error).toMatchObject({ cause: { errcode: 5 } });
          throw error;
        } finally {
          // The caller ends before the awaiting lease owner consumes the worker's result.
          controller.abort(new Error("cancel pending acquisition"));
        }
      });
      const run = vi.fn(async () => undefined);
      try {
        const failure = await withOmnipolymathStateLease(
          leaseOptions(state.env, identity.key, { waitMs: 0, signal: controller.signal }),
          run,
        ).catch((error: unknown) => error);
        expect(failure).toMatchObject({
          code: "OMNIPOLYMATH_STATE_LEASE_ABORTED",
          cause: controller.signal.reason,
        });
        if (outcome === "acquired") {
          expect(failure).not.toBeInstanceOf(OmnipolymathStateLeaseAcquisitionError);
        } else {
          expect(failure).toMatchObject({
            outcome: { kind: "aborted", reason: "caller-signal", elapsedMs: expect.any(Number) },
          });
        }
        expect(run).not.toHaveBeenCalled();
        expect(database.db.prepare("SELECT owner FROM state_leases").all()).toEqual(
          outcome === "held" ? [{ owner: identity.owner }] : [],
        );
      } finally {
        writer?.exec("ROLLBACK");
        writer?.close();
      }
    });
  },
);

it("restores the cached connection timeout after preparation fails during schema publication", async () => {
  await withOmnipolymathTestState({ label: "lease-preparation-restoration" }, async (state) => {
    const database = openOmnipolymathStateDatabase({ env: state.env });
    database.db
      .prepare(
        "INSERT INTO config_machine_state (state_key, value_json, updated_at_ms) VALUES (?, ?, ?)",
      )
      .run(CONTENT_VERSION_KEY, String(OMNIPOLYMATH_STATE_SCHEMA_VERSION), Date.now());
    database.db.exec(`
      PRAGMA user_version = ${OMNIPOLYMATH_STATE_SCHEMA_VERSION - 1};
      UPDATE schema_meta SET schema_version = ${OMNIPOLYMATH_STATE_SCHEMA_VERSION - 1}
      WHERE meta_key = 'primary';
    `);
    closeOmnipolymathStateDatabaseForTest();
    let writer: DatabaseSync | undefined;
    let preparedBusyTimeoutMs: number | undefined;
    const unregister = registerOmnipolymathStateDatabaseLifecycleListener((event) => {
      if (event.kind === "opened" && event.database.path === database.path) {
        preparedBusyTimeoutMs = readSqliteBusyTimeout(
          requireNativeSqliteDatabase(event.database.db),
        );
        writer = new DatabaseSync(database.path);
        writer.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
      }
    });
    const sleep = vi.spyOn(backoff, "sleepWithAbort");
    try {
      await expect(
        withAgentDatabaseMaintenanceLease({ env: state.env }, async (lease) => {
          lease.assertOwned();
        }),
      ).rejects.toMatchObject({
        code: "OMNIPOLYMATH_STATE_LEASE_STORAGE_FAILED",
        outcome: { kind: "store-unavailable", reason: "sqlite-busy" },
      });
      expect(preparedBusyTimeoutMs).toBe(0);
      expect(sleep).not.toHaveBeenCalled();
      if (writer?.isOpen) {
        writer.exec("ROLLBACK");
        writer.close();
      }
      expect(
        readSqliteBusyTimeout(
          requireNativeSqliteDatabase(openOmnipolymathStateDatabase({ env: state.env }).db),
        ),
      ).toBe(OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS);
    } finally {
      unregister();
      if (writer?.isOpen) {
        writer.exec("ROLLBACK");
        writer.close();
      }
    }
  });
});

it.each(["invalid", "aborted"] as const)(
  "rejects %s admission before preparing storage",
  async (reason) => {
    await withOmnipolymathTestState({ label: "lease-refused-preparation" }, async (state) => {
      const controller = new AbortController();
      if (reason === "aborted") {
        controller.abort();
      }
      await expect(
        withOmnipolymathStateLease(
          leaseOptions(state.env, "refused-preparation", {
            leaseMs: reason === "invalid" ? 0 : 60_000,
            prepareDatabase: true,
            signal: controller.signal,
          }),
          async () => undefined,
        ),
      ).rejects.toMatchObject({
        code:
          reason === "invalid"
            ? "OMNIPOLYMATH_STATE_LEASE_INVALID_INPUT"
            : "OMNIPOLYMATH_STATE_LEASE_ABORTED",
        ...(reason === "aborted"
          ? { outcome: { kind: "aborted", reason: "caller-signal", elapsedMs: expect.any(Number) } }
          : {}),
      });
      expect(fs.existsSync(resolveOmnipolymathStateSqlitePath(state.env))).toBe(false);
    });
  },
);

it.each([false, true])(
  "rejects an active database transaction before acquisition (supplied handle: %s)",
  async (supplied) => {
    await withOmnipolymathTestState({ label: "lease-active-transaction" }, async (state) => {
      const database = openOmnipolymathStateDatabase({ env: state.env });
      const options = leaseOptions(state.env, "active-transaction", {
        database: {
          scope: "shared",
          options: { env: state.env, ...(supplied ? { database } : {}) },
        },
        waitMs: 0,
      });
      const run = vi.fn(async (lease: OmnipolymathStateLeaseContext) => lease.assertOwned());
      database.db.exec("BEGIN");
      database.db.prepare("SELECT owner FROM state_leases").all();
      let failure: unknown;
      try {
        failure = await withOmnipolymathStateLease(options, run).catch((error: unknown) => error);
      } finally {
        database.db.exec("ROLLBACK");
      }
      expect({
        failure,
        entered: run.mock.calls.length,
        leases: database.db.prepare("SELECT owner FROM state_leases").all(),
      }).toMatchObject({
        failure: { code: "OMNIPOLYMATH_STATE_LEASE_INVALID_INPUT" },
        entered: 0,
        leases: [],
      });
      await withOmnipolymathStateLease(options, run);
      expect(run).toHaveBeenCalledOnce();
      expect(database.db.prepare("SELECT owner FROM state_leases").all()).toEqual([]);
    });
  },
);
