import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { constants, DatabaseSync } from "node:sqlite";
import { expectDefined } from "@omnipolymath/normalization-core";
import { mapRetainedOperation } from "@omnipolymath/worker-runtime/lifecycle";
import { afterEach, expect, it, vi } from "vitest";
import { createFixtureLifetime } from "../../test/helpers/fixture-lifetime.js";
import { awaitGateBeforeSettlement, withinTest } from "../../test/helpers/promise.js";
import { stopChildProcess } from "../../test/helpers/stop-child-process.js";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import * as nodeSqlite from "../infra/node-sqlite.js";
import { cleanupSnapshotOperations } from "../infra/sqlite-readonly-location-cleanup.js";
import * as sqliteReadOnly from "../infra/sqlite-snapshot-source.js";
import { createDeferredCore } from "../shared/deferred.js";
import { requireNativeSqliteDatabase } from "../test-utils/native-sqlite.js";
import { withOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";
import { withTempDir } from "../test-utils/temp-dir.js";
import { clearOmnipolymathDatabaseQuarantine } from "./omnipolymath-quarantine-store.js";
import { seedOmnipolymathDatabaseQuarantine } from "./omnipolymath-quarantine-store.test-support.js";
import { StateDatabaseReadAdmissionInvalidatedError } from "./omnipolymath-state-db-async-lifecycle.js";
import {
  closeOmnipolymathStateDatabaseAsync,
  recordOmnipolymathStateDatabaseOpenFailure,
} from "./omnipolymath-state-db-cache.js";
import { createDanglingSkillWorkshopReviewIndex } from "./omnipolymath-state-db-corruption.test-support.js";
import {
  isOmnipolymathStateDatabaseDefinitelyAbsent,
  executeExistingOmnipolymathStateRead,
  withSynchronousArtifactPreservingStateSnapshot,
  isArtifactPreservingStateRead,
  withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnly,
  withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnlyAsync,
  withExistingOmnipolymathStateDatabaseReadOnly,
  withArtifactPreservingStateReads,
  withDisposableOmnipolymathStateReads,
  withOmnipolymathStateDatabaseReadSnapshot,
} from "./omnipolymath-state-db-readonly.js";
import {
  closeOmnipolymathStateDatabaseForTest,
  openOmnipolymathStateDatabase,
  runOmnipolymathStateWriteTransaction,
} from "./omnipolymath-state-db.js";

function createOptions(stateDir: string) {
  return {
    env: { OMNIPOLYMATH_STATE_DIR: stateDir, OMNIPOLYMATH_TEST_FAST: "1" },
    path: path.join(stateDir, "state", "omnipolymath.sqlite"),
  };
}

function createClosedState(stateDir: string) {
  const options = createOptions(stateDir);
  openOmnipolymathStateDatabase(options);
  closeOmnipolymathStateDatabaseForTest();
  return options;
}

const snapshot = <T>(operation: () => T) =>
  withArtifactPreservingStateReads(() => withSynchronousArtifactPreservingStateSnapshot(operation));

function createWalFixture(root: string) {
  const options = createClosedState(root);
  const writer = new DatabaseSync(options.path);
  writer.exec(
    "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE held(value TEXT); INSERT INTO held VALUES ('first');",
  );
  const read = () =>
    withExistingOmnipolymathStateDatabaseReadOnly(
      ({ db }) => db.prepare("SELECT value FROM held").get()?.value,
      options,
    );
  const artifacts = () =>
    ["", "-wal", "-shm"].map((suffix) => fs.readFileSync(options.path + suffix));
  return { options, writer, read, artifacts };
}

// Vitest can enter teardown while a timed-out body is still closing its native owners.
const fixture = createFixtureLifetime();
const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    await fixture.cleanup();
    vi.restoreAllMocks();
    closeOmnipolymathStateDatabaseForTest();
    cleanup();
  }),
);

it.each([undefined, "EACCES"])(
  "keeps authoritative state availability (filesystem failure: %s)",
  async (code) => {
    await withTempDir("omnipolymath-state-availability-", async (root) => {
      const options = createOptions(root);
      if (code) {
        const probe = vi.spyOn(fs, "lstatSync").mockImplementation(() => {
          throw Object.assign(new Error("synthetic filesystem observation"), { code });
        });
        syncBuiltinESMExports();
        try {
          expect(isOmnipolymathStateDatabaseDefinitelyAbsent(options.env)).toBe(false);
          expect(probe).toHaveBeenCalledOnce();
        } finally {
          probe.mockRestore();
          syncBuiltinESMExports();
        }
        return;
      }
      expect(isOmnipolymathStateDatabaseDefinitelyAbsent(options.env)).toBe(true);
      openOmnipolymathStateDatabase(options);
      const observeMissingPath = (retained: boolean) => {
        const probe = vi.spyOn(fs, "lstatSync").mockImplementation(() => {
          throw Object.assign(new Error("synthetic missing-path observation"), { code: "ENOENT" });
        });
        syncBuiltinESMExports();
        try {
          expect(isOmnipolymathStateDatabaseDefinitelyAbsent(options.env)).toBe(!retained);
          expect(probe).toHaveBeenCalledTimes(retained ? 0 : 1);
        } finally {
          probe.mockRestore();
          syncBuiltinESMExports();
        }
      };
      observeMissingPath(true);
      closeOmnipolymathStateDatabaseForTest();
      await withOmnipolymathStateDatabaseReadSnapshot(async () => observeMissingPath(true), options);
      snapshot(() =>
        withExistingOmnipolymathStateDatabaseReadOnly(() => observeMissingPath(true), options),
      );
      observeMissingPath(false);
      expect(fs.existsSync(options.path)).toBe(true);
    });
  },
);

it("keeps fresh synchronous read callbacks from returning asynchronous work", async () => {
  await withTempDir("omnipolymath-state-sync-read-", async (root) => {
    const options = createClosedState(root);
    let reader: DatabaseSync | undefined;
    expect(() =>
      withExistingOmnipolymathStateDatabaseReadOnly(({ db }) => {
        reader = requireNativeSqliteDatabase(db);
        return Promise.resolve(1);
      }, options),
    ).toThrow("SQLite source read must remain synchronous");
    expect(reader?.isOpen).toBe(false);
  });
});

it("preserves query authorization denial and recovers the cached reader", async () => {
  await withOmnipolymathTestState({ label: "state-readonly-authorizer" }, async ({ env }) => {
    const options = { env };
    const opened = openOmnipolymathStateDatabase(options);
    let denied = false;
    const operation = vi.fn(({ db }: { db: typeof opened.db }) => {
      requireNativeSqliteDatabase(db).setAuthorizer((action) => {
        if (action === constants.SQLITE_SELECT && !denied) {
          denied = true;
          return constants.SQLITE_DENY;
        }
        return constants.SQLITE_OK;
      });
      return db.prepare("SELECT role FROM schema_meta").get();
    });
    try {
      expect(() => withExistingOmnipolymathStateDatabaseReadOnly(operation, options)).toThrow(
        /not authorized/,
      );
    } finally {
      requireNativeSqliteDatabase(opened.db).setAuthorizer(null);
    }
    expect(denied).toBe(true);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(
      withExistingOmnipolymathStateDatabaseReadOnly(({ db }) => {
        expect(db).toBe(opened.db);
        return db.prepare("SELECT role FROM schema_meta").get();
      }, options),
    ).toEqual({ role: "global" });
  });
});

it("waits for a transient database lock before a fresh read-only schema inspection", ({ signal }) =>
  fixture.run(async () => {
    signal.throwIfAborted();
    const stateDir = tempDirs.make("omnipolymath-state-readonly-busy-");
    const options = createOptions(stateDir);
    await fsp.mkdir(path.dirname(options.path), { recursive: true });
    signal.throwIfAborted();
    const setup = new DatabaseSync(options.path);
    try {
      setup.exec("CREATE TABLE held(value TEXT); INSERT INTO held VALUES ('committed');");
    } finally {
      setup.close();
    }
    const before = fs.readFileSync(options.path);
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
            import { DatabaseSync } from "node:sqlite";
            const db = new DatabaseSync(process.argv[1]);
            db.exec("BEGIN EXCLUSIVE; UPDATE held SET value = 'uncommitted';");
            process.once("message", () => {
              setTimeout(() => {
                db.exec("ROLLBACK");
                db.close();
                process.disconnect();
              }, 200);
            });
            process.send({ locked: true });
          `,
        options.path,
      ],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    let stderr = "";
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once("close", (code, exitSignal) => resolve({ code, signal: exitSignal }));
      },
    );
    try {
      expectDefined(child.stderr, "SQLite lock child stderr pipe").on("data", (chunk) => {
        stderr += String(chunk);
      });
      const [ready] = await withinTest(
        awaitGateBeforeSettlement(
          once(child, "message", { signal }),
          closed,
          "SQLite lock child exited before acquiring its exclusive lock",
        ),
        signal,
      );
      expect(ready).toEqual({ locked: true });
      // The child releases independently while the synchronous reader waits inside SQLite.
      child.send({ release: true });
      const rows = withExistingOmnipolymathStateDatabaseReadOnly(({ db }) => {
        expect(() => db.exec("INSERT INTO held VALUES ('unexpected')")).toThrow(/readonly/);
        expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
        return db.prepare("SELECT value FROM held").all();
      }, options);
      expect(rows).toEqual([{ value: "committed" }]);
      expect(await withinTest(closed, signal), stderr).toEqual({ code: 0, signal: null });
      expect(fs.readFileSync(options.path)).toEqual(before);
    } finally {
      await fixture.verifyCleanup(async () => {
        await stopChildProcess(child, 5_000);
        await closed;
      });
    }
  }));

it("reads only active disposable scopes directly and revokes inherited async access", async () => {
  await withTempDir("omnipolymath-state-disposable-", async (root) => {
    const outer = createOptions(path.join(root, "outer"));
    const inner = createOptions(path.join(root, "inner"));
    const source = createOptions(path.join(root, "source"));
    const paths = [outer, inner, source];
    for (const options of paths) {
      fs.mkdirSync(path.dirname(options.path), { recursive: true });
      const db = new DatabaseSync(options.path);
      db.exec(
        "PRAGMA journal_mode = WAL; CREATE TABLE held(value TEXT); INSERT INTO held VALUES ('committed')",
      );
      db.close();
    }
    const read = (options: ReturnType<typeof createOptions>) =>
      withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnlyAsync(({ db }) => {
        expect(isArtifactPreservingStateRead()).toBe(true);
        expect(db.prepare("SELECT value FROM held").get()).toEqual({ value: "committed" });
        expect(() => db.exec("INSERT INTO held VALUES ('unexpected')")).toThrow(/readonly/);
        return requireNativeSqliteDatabase(db).location();
      }, options);
    const sourceBefore = fs.readFileSync(source.path);
    const released = createDeferredCore();
    let descendant: Promise<unknown> | undefined;
    await withDisposableOmnipolymathStateReads(outer.path, async () => {
      expect(await read(outer)).toBe(outer.path);
      await withDisposableOmnipolymathStateReads(inner.path, async () => {
        expect(await read(outer)).toBe(outer.path);
        expect(await read(inner)).toBe(inner.path);
        expect(await read(source)).not.toBe(source.path);
        descendant = released.promise.then(() => read(inner));
      });
      expect(await read(inner)).not.toBe(inner.path);
      expect(await read(outer)).toBe(outer.path);
      released.resolve();
      await expect(descendant).rejects.toBeInstanceOf(StateDatabaseReadAdmissionInvalidatedError);
    });
    expect(await read(outer)).not.toBe(outer.path);
    expect(fs.readFileSync(source.path)).toEqual(sourceBefore);
    expect(fs.readdirSync(path.dirname(source.path))).toEqual(["omnipolymath.sqlite"]);
  });
});
it("requires Doctor for the exact dangling Workshop index without changing its source", async () => {
  await withTempDir("omnipolymath-state-readonly-dangling-workshop-", async (stateDir) => {
    const options = createClosedState(stateDir);
    createDanglingSkillWorkshopReviewIndex(options.path);
    const before = fs.readFileSync(options.path);

    await expect(
      Promise.resolve().then(() =>
        withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnly(
          ({ db }) => db.prepare("SELECT role FROM schema_meta").get(),
          options,
        ),
      ),
    ).rejects.toThrow(/legacy-workshop-review-index.*omnipolymath doctor --fix/);
    expect(fs.readFileSync(options.path).equals(before), options.path).toBe(true);
  });
});
it("reuses an idle writer but isolates its transaction", async () => {
  await withTempDir("omnipolymath-state-readonly-isolated-", async (stateDir) => {
    const options = createOptions(stateDir);
    const opened = openOmnipolymathStateDatabase(options);
    opened.db.exec("CREATE TABLE held(value TEXT); INSERT INTO held VALUES ('original');");
    let called = false;
    const idle = withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnlyAsync(({ db }) => {
      called = true;
      expect(isArtifactPreservingStateRead()).toBe(true);
      expect(db).toBe(opened.db);
      return db.prepare("SELECT value FROM held").all();
    }, options);
    expect(called).toBe(true);
    expect(isArtifactPreservingStateRead()).toBe(false);
    const writer = opened.db;
    writer.exec("BEGIN; UPDATE held SET value = 'uncommitted';");
    try {
      expect(await idle).toEqual([{ value: "original" }]);
      expect(writer.isTransaction).toBe(true);
      const result = await withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnlyAsync(
        ({ db, path: pathname }) => {
          expect(db).not.toBe(writer);
          expect(pathname).toBe(options.path);
          return db.prepare("SELECT value FROM held").all();
        },
        options,
      );
      expect(result).toEqual([{ value: "original" }]);
      expect(writer.isTransaction).toBe(true);
      expect(writer.prepare("SELECT value FROM held").all()).toEqual([{ value: "uncommitted" }]);
    } finally {
      writer.exec("ROLLBACK");
    }
  });
});

it.each([
  { failure: "quarantine", composite: false },
  { failure: "callback", composite: true },
] as const)(
  "cleans the async snapshot after $failure rejection (composite: $composite)",
  async ({ failure, composite }) => {
    await withTempDir("omnipolymath-state-readonly-admission-", async (stateDir) => {
      const options = createClosedState(stateDir);
      const refused = new Error("synthetic readonly verification failure");
      let preparedLocation: string | undefined;
      let failurePublished = false;
      if (composite) {
        const start = sqliteReadOnly.startSqliteReadOnlyLocationAsync;
        vi.spyOn(sqliteReadOnly, "startSqliteReadOnlyLocationAsync").mockImplementationOnce(
          (...args) => {
            const preparation = start(...args);
            return {
              ...preparation,
              ...mapRetainedOperation(preparation, (prepared) => {
                preparedLocation = prepared.location;
                return prepared;
              }),
            };
          },
        );
      } else {
        const prepare = sqliteReadOnly.prepareSqliteReadOnlyLocation;
        vi.spyOn(sqliteReadOnly, "prepareSqliteReadOnlyLocation").mockImplementationOnce(
          async (...args) => {
            const prepared = await prepare(...args);
            preparedLocation = prepared.location;
            seedOmnipolymathDatabaseQuarantine({
              env: options.env,
              kind: "state",
              path: options.path,
              reason: "synthetic readonly quarantine",
            });
            failurePublished = true;
            return prepared;
          },
        );
      }
      const operation = vi.fn(() => {
        throw refused;
      });
      try {
        const result = composite
          ? withArtifactPreservingStateReads(() =>
              withOmnipolymathStateDatabaseReadSnapshot(
                async () => withExistingOmnipolymathStateDatabaseReadOnly(operation, options),
                options,
              ),
            )
          : withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnlyAsync(operation, options);
        if (failure !== "quarantine") {
          await expect(result).rejects.toBe(refused);
        } else {
          await expect(result).rejects.toThrow("synthetic readonly quarantine");
        }
        if (failure === "callback") {
          expect(operation).toHaveBeenCalledOnce();
        } else {
          expect(failurePublished).toBe(true);
          expect(operation).not.toHaveBeenCalled();
        }
        expect(preparedLocation).toBeDefined();
        expect(fs.existsSync(path.dirname(preparedLocation!))).toBe(false);
        expect(isArtifactPreservingStateRead()).toBe(false);
      } finally {
        clearOmnipolymathDatabaseQuarantine(options.path, { env: options.env });
      }
    });
  },
);

it("keeps missing and non-missing filesystem failures distinct for async reads", async () => {
  await withTempDir("omnipolymath-state-readonly-missing-", async (stateDir) => {
    const options = createOptions(stateDir);
    const operation = vi.fn();
    await expect(
      withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnlyAsync(operation, options),
    ).resolves.toBeUndefined();
    fs.writeFileSync(path.join(stateDir, "file"), "not a directory");
    await expect(
      withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnlyAsync(operation, {
        ...options,
        path: path.join(stateDir, "file", "state.sqlite"),
      }),
    ).rejects.toMatchObject({ code: "ENOTDIR" });
    expect(operation).not.toHaveBeenCalled();
  });
});

it.each(["synchronous", "report"])(
  "shares one %s snapshot reader and refreshes committed WAL next time",
  async (mode) => {
    await withTempDir("omnipolymath-metadata-snapshot-", async (root) => {
      const { options, writer, read, artifacts } = createWalFixture(root);
      const open = vi.spyOn(nodeSqlite, "openNodeSqliteDatabase");
      const openedReaders = () =>
        open.mock.calls.filter(
          ([location, opts]) => location.includes("database.sqlite") && opts?.readOnly,
        );
      const run = (operation: () => unknown) =>
        mode === "synchronous"
          ? snapshot(operation)
          : withArtifactPreservingStateReads(() =>
              withOmnipolymathStateDatabaseReadSnapshot(async () => operation(), options),
            );
      try {
        const before = artifacts();
        await run(() => {
          expect(read()).toBe("first");
          expect(read()).toBe("first");
        });
        expect(openedReaders()).toHaveLength(1);
        artifacts().forEach((data, i) => expect(data.equals(before[i]!), `SQLite ${i}`).toBe(true));
        await run(() => {
          expect(read()).toBe("first");
          writer.exec("UPDATE held SET value='second'");
          expect(read()).toBe("first");
        });
        expect(openedReaders()).toHaveLength(2);
        await run(() => expect(read()).toBe("second"));
        expect(openedReaders()).toHaveLength(3);
        await expect(
          Promise.resolve().then(() =>
            run(() => {
              read();
              throw new Error("consumer failure");
            }),
          ),
        ).rejects.toThrow("consumer failure");
        await run(() => expect(read()).toBe("second"));
        expect(openedReaders()).toHaveLength(5);
        expect(
          open.mock.results.every((result) => result.type !== "return" || !result.value.isOpen),
        ).toBe(true);
        if (mode === "synchronous") {
          expect(() => snapshot(() => Promise.resolve(1))).toThrow("must remain synchronous");
        }
      } finally {
        writer.close();
      }
    });
  },
);

it("keeps the original synchronous snapshot while retained current reads see later commits", async () => {
  await withTempDir("omnipolymath-retained-inherited-snapshot-", async (root) => {
    const options = createClosedState(root);
    const writer = new DatabaseSync(options.path);
    writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
    writer
      .prepare("INSERT INTO config_machine_state VALUES (?, ?, ?)")
      .run("retained.snapshot.fixture", '"first"', 1);
    const controller = new AbortController();
    const pending: Array<ReturnType<typeof executeExistingOmnipolymathStateRead>> = [];
    const legacyRead = () =>
      withExistingOmnipolymathStateDatabaseReadOnly(
        ({ db }) =>
          db
            .prepare("SELECT value_json FROM config_machine_state WHERE state_key = ?")
            .get("retained.snapshot.fixture")?.value_json,
        options,
      );
    const startRead = (current = false) => {
      pending.push(
        executeExistingOmnipolymathStateRead(
          options,
          { type: "tui.lastSession.read", stateKey: "retained.snapshot.fixture" },
          { current, signal: controller.signal },
        ),
      );
    };
    try {
      snapshot(() => {
        expect(legacyRead()).toBe('"first"');
        writer
          .prepare(
            "UPDATE config_machine_state SET value_json = ?, updated_at_ms = 2 WHERE state_key = ?",
          )
          .run('"second"', "retained.snapshot.fixture");
        const prepare = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(() => {
          throw new Error("Retained read prepared SQLite on the caller thread");
        });
        const exec = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(() => {
          throw new Error("Retained read executed SQLite on the caller thread");
        });
        try {
          startRead();
          startRead(true);
          startRead();
          expect(prepare).not.toHaveBeenCalled();
          expect(exec).not.toHaveBeenCalled();
        } finally {
          prepare.mockRestore();
          exec.mockRestore();
        }
        expect(legacyRead()).toBe('"first"');
      });
      const replies = await Promise.all(pending);
      expect(
        replies.map((reply) => {
          if (!reply?.ok || reply.type !== "tui.lastSession.read") {
            throw new Error("Retained state read returned the wrong domain reply");
          }
          return reply.row?.value_json;
        }),
      ).toEqual(['"first"', '"second"', '"first"']);
    } finally {
      controller.abort(new Error("Snapshot proof finished"));
      await Promise.allSettled(pending);
      await closeOmnipolymathStateDatabaseAsync();
      await cleanupSnapshotOperations();
      writer.close();
    }
  });
});

it("reads fresh authority without replacing an inherited discovery snapshot", async () => {
  await withTempDir("omnipolymath-current-snapshot-", async (root) => {
    const { options, writer, read, artifacts } = createWalFixture(root);
    const current = () =>
      withSynchronousArtifactPreservingStateSnapshot(() => [read(), read()], {
        current: options,
      });
    const inspect = () => {
      expect(read()).toBe("first");
      writer.exec("UPDATE held SET value='revoked'");
      const before = artifacts();
      expect(current()).toEqual(["revoked", "revoked"]);
      artifacts().forEach((data, i) => expect(data.equals(before[i]!), `SQLite ${i}`).toBe(true));
      expect(read()).toBe("first");
      expect(() =>
        withSynchronousArtifactPreservingStateSnapshot(
          () => {
            expect(read()).toBe("revoked");
            throw new Error("authority consumer failed");
          },
          { current: options },
        ),
      ).toThrow("authority consumer failed");
      expect(read()).toBe("first");
      writer.exec("UPDATE held SET value='later'");
      expect(current()).toEqual(["later", "later"]);
      expect(read()).toBe("first");
      writer.exec("UPDATE held SET value='composite'");
      const prepare = vi.spyOn(sqliteReadOnly, "prepareSqliteReadOnlyLocationSync");
      try {
        expect(
          withSynchronousArtifactPreservingStateSnapshot(() => [read(), ...current()], {
            current: options,
          }),
        ).toEqual(["composite", "composite", "composite"]);
        expect(prepare).toHaveBeenCalledOnce();
      } finally {
        prepare.mockRestore();
      }
      expect(read()).toBe("first");
      const foreign = createOptions(path.join(root, "foreign"));
      openOmnipolymathStateDatabase(foreign).db.exec(
        "CREATE TABLE held(value TEXT); INSERT INTO held VALUES ('committed');",
      );
      runOmnipolymathStateWriteTransaction(({ db }) => {
        db.exec("UPDATE held SET value='uncommitted'");
        expect(
          withSynchronousArtifactPreservingStateSnapshot(
            () =>
              withExistingOmnipolymathStateDatabaseReadOnly(
                ({ db: reader }) => reader.prepare("SELECT value FROM held").get()?.value,
                foreign,
              ),
            { current: options },
          ),
        ).toBe("committed");
      }, foreign);
    };
    try {
      await withArtifactPreservingStateReads(() =>
        withOmnipolymathStateDatabaseReadSnapshot(async () => {
          inspect();
          await Promise.resolve();
          writer.exec("UPDATE held SET value='after-await'");
          expect(current()).toEqual(["after-await", "after-await"]);
          expect(read()).toBe("first");
        }, options),
      );
    } finally {
      writer.close();
      await closeOmnipolymathStateDatabaseAsync();
    }
  });
});

it.each(["admission", "cleanup"] as const)(
  "rejects a scoped metadata %s failure without reusing invalid state",
  async (phase) => {
    await withTempDir("omnipolymath-metadata-failure-", async (root) => {
      const options = createClosedState(root);
      const failure = new Error("synthetic verification failure");
      const read = () => withExistingOmnipolymathStateDatabaseReadOnly(() => 1, options);
      const scope = (operation = read) => snapshot(operation);
      if (phase === "admission") {
        scope(() => {
          expect(read()).toBe(1);
          recordOmnipolymathStateDatabaseOpenFailure(options.path, failure);
          expect(read).toThrow("synthetic verification failure");
          return 1;
        });
      } else {
        const prepare = sqliteReadOnly.prepareSqliteReadOnlyLocationSync;
        let cleanup: (() => boolean) | undefined;
        vi.spyOn(sqliteReadOnly, "prepareSqliteReadOnlyLocationSync").mockImplementationOnce(
          (pathname) => {
            const prepared = prepare(pathname);
            cleanup = prepared.cleanup;
            return {
              ...prepared,
              cleanup: vi
                .fn()
                .mockImplementationOnce(() => false)
                .mockImplementation(prepared.cleanup),
            };
          },
        );
        try {
          expect(() => scope()).toThrow("metadata snapshot cleanup failed");
          expect(scope()).toBe(1);
        } finally {
          cleanup?.();
        }
      }
    });
  },
);
