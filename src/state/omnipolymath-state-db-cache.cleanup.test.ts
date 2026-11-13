import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { acquireGatewayStateOwner } from "../infra/gateway-state-owner.js";
import * as kyselyCache from "../infra/kysely-sync-cache-state.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { readSqliteDatabaseCleanClose } from "../infra/sqlite-database-admission.js";
import { requireNativeSqliteDatabase } from "../test-utils/native-sqlite.js";
import { createOmnipolymathDatabaseMaintenanceScope } from "./omnipolymath-state-db-async-lifecycle.js";
import {
  omnipolymathStateDatabaseCache as cache,
  readOmnipolymathStateWalHealth,
  retainOmnipolymathStateDatabase,
} from "./omnipolymath-state-db-cache.js";
import { openOmnipolymathStateDatabase } from "./omnipolymath-state-db.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) => {
  afterEach(() => {
    vi.restoreAllMocks();
    cache.closeOmnipolymathStateDatabaseForTest();
    vi.unstubAllEnvs();
    cleanup();
  });
});

describe("shared-state disposal ownership", () => {
  it("retires without waiting for a peer snapshot and leaves its WAL unsealed", () => {
    const root = tempDirs.make("omnipolymath-state-pinned-close-");
    const owner = openOmnipolymathStateDatabase({ path: path.join(root, "state.sqlite") });
    owner.db.exec(
      "INSERT INTO state_leases(scope, lease_key, owner, created_at, updated_at) VALUES ('close', 'fixture', 'before', 1, 1)",
    );
    using reader = openNodeSqliteDatabase(owner.path, { readOnly: true });
    reader.exec("BEGIN");
    const read = () => reader.prepare("SELECT owner FROM state_leases WHERE scope='close'").get();
    expect(read()).toEqual({ owner: "before" });
    owner.db.exec("UPDATE state_leases SET owner='after' WHERE scope='close'");

    const started = performance.now();
    cache.closeOmnipolymathStateDatabaseByPath(owner.path);
    const elapsed = performance.now() - started;
    expect(owner.db.isOpen).toBe(false);
    expect(read()).toEqual({ owner: "before" });
    expect(fs.statSync(`${owner.path}-wal`).size).toBeGreaterThan(0);
    expect(readSqliteDatabaseCleanClose(owner.path)).toBe(false);
    reader.close();
    const reopened = openOmnipolymathStateDatabase({ path: owner.path });
    expect(reopened.db.prepare("SELECT owner FROM state_leases WHERE scope='close'").get()).toEqual(
      { owner: "after" },
    );
    cache.closeOmnipolymathStateDatabaseByPath(owner.path);
    // The live reader must not consume the normal five-second write busy timeout.
    expect(elapsed).toBeLessThan(1_000);
  });

  it("disposes a revoked owner's exact handle without changing a successor SQLite family", async () => {
    await using cleanup = new AsyncDisposableStack();
    const root = tempDirs.make("omnipolymath-state-revoked-disposal-");
    const databasePath = path.join(root, "state", "omnipolymath.sqlite");
    const retiredPath = path.join(root, "retired.sqlite");
    const physical = acquireGatewayStateOwner({ databasePath });
    cleanup.defer(() => physical.release());
    let live = true;
    const scope = createOmnipolymathDatabaseMaintenanceScope({
      schemaMaintenance: true,
      assertDatabaseAccess: physical.assertDatabaseAccess,
      assertOwnerCurrent() {
        physical.assertCurrent();
        if (!live) {
          throw new Error("Fixture maintenance authority retired");
        }
      },
    });
    const suffixes = ["", "-wal", "-shm"] as const;
    const snapshot = () =>
      suffixes.map((suffix) => {
        const pathname = databasePath + suffix;
        const bytes = fs.readFileSync(pathname);
        const { dev, ino, mode, size, mtimeNs, ctimeNs } = fs.statSync(pathname, {
          bigint: true,
        });
        return { bytes, dev, ino, mode, size, mtimeNs, ctimeNs };
      });
    const replacement: { db?: ReturnType<typeof openNodeSqliteDatabase> } = {};
    cleanup.defer(() => replacement.db?.close());
    cleanup.defer(async () => {
      live = true;
      await scope.close();
    });
    const owner = scope.run(() => {
      const database = openOmnipolymathStateDatabase({ path: databasePath });
      retainOmnipolymathStateDatabase(database);
      database.db.exec("CREATE TABLE original(value TEXT); INSERT INTO original VALUES ('kept')");
      return database;
    });
    live = false;
    if (process.platform === "win32") {
      const before = snapshot();
      expect(() => fs.renameSync(databasePath, retiredPath)).toThrow(
        expect.objectContaining({ code: expect.stringMatching(/^(?:EACCES|EBUSY|EPERM)$/u) }),
      );
      expect(snapshot()).toEqual(before);
      await expect(scope.close()).resolves.toBeUndefined();
      expect(owner.db.isOpen).toBe(false);
    }
    for (const suffix of suffixes) {
      if (fs.existsSync(databasePath + suffix)) {
        fs.renameSync(databasePath + suffix, retiredPath + suffix);
      }
    }
    replacement.db = openNodeSqliteDatabase(databasePath);
    replacement.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE successor(value TEXT); INSERT INTO successor VALUES ('preserved')",
    );
    const before = snapshot();
    await expect(scope.close()).resolves.toBeUndefined();
    expect(owner.db.isOpen).toBe(false);
    physical.assertCurrent();
    expect(snapshot()).toEqual(before);
    expect(replacement.db.prepare("SELECT value FROM successor").all()).toEqual([
      { value: "preserved" },
    ]);
  });

  it.each(["canonical", "borrow"] as const)(
    "retries released-borrow cleanup through the %s owner without closing its replacement",
    (retry) => {
      const root = tempDirs.make("omnipolymath-state-borrow-cleanup-");
      const owner = openOmnipolymathStateDatabase({ path: path.join(root, "state.sqlite") });
      const borrow = retainOmnipolymathStateDatabase(owner);
      using _ = { [Symbol.dispose]: () => borrow.release() };
      const failure = new Error("maintenance cleanup callback failed");
      const closeMaintenance = owner.walMaintenance.close;
      vi.spyOn(owner.walMaintenance, "close").mockImplementationOnce((options) => {
        closeMaintenance(options);
        throw failure;
      });

      expect(() => borrow.release()).toThrow(failure);
      expect(owner.db.isOpen).toBe(false);
      if (retry === "canonical") {
        expect(cache.closeOmnipolymathStateDatabaseByPath(owner.path)).toBe(true);
      } else {
        expect(() => borrow.release()).not.toThrow();
      }
      const replacement = openOmnipolymathStateDatabase({ path: owner.path });
      borrow.release();
      expect(replacement.db.isOpen).toBe(true);
    },
  );

  it("reads only recorded WAL health and forgets it when the database retires", () => {
    vi.stubEnv("OMNIPOLYMATH_STATE_DIR", tempDirs.make("omnipolymath-state-wal-health-"));
    expect(readOmnipolymathStateWalHealth()).toBeUndefined();
    const owner = openOmnipolymathStateDatabase();
    expect(readOmnipolymathStateWalHealth()).toBeUndefined();
    expect(owner.walMaintenance.checkpoint()).toBe(true);
    const prepare = vi.spyOn(owner.db, "prepare");
    const recorded = readOmnipolymathStateWalHealth();
    expect(recorded).toMatchObject({ state: "complete", warning: false });
    expect(prepare).not.toHaveBeenCalled();
    if (recorded) {
      recorded.warning = true;
    }
    expect(readOmnipolymathStateWalHealth()?.warning).toBe(false);
    cache.closeOmnipolymathStateDatabaseByPath(owner.path);
    expect(readOmnipolymathStateWalHealth()).toBeUndefined();
  });
  it.each(["path", "all", "corruption"] as const)(
    "retains a failed native close for disposal without a cache hit after %s retirement",
    (scope) => {
      const root = tempDirs.make("omnipolymath-state-disposal-");
      const owner = openOmnipolymathStateDatabase({ path: path.join(root, "failed.sqlite") });
      const healthy = openOmnipolymathStateDatabase({ path: path.join(root, "healthy.sqlite") });
      owner.db.exec("CREATE TABLE retained(value TEXT); INSERT INTO retained VALUES ('original')");
      const failure = new Error("native close refused");
      const close = vi.spyOn(owner.db, "close").mockImplementation(() => {
        throw failure;
      });
      if (scope === "corruption") {
        expect(cache.evictCachedOmnipolymathStateDatabase(owner)).toBe(true);
      } else {
        expect(() =>
          scope === "path"
            ? cache.closeOmnipolymathStateDatabaseByPath(owner.path)
            : cache.closeOmnipolymathStateDatabase(),
        ).toThrow(failure);
      }
      expect(owner.db.isOpen).toBe(true);
      expect(cache.getOmnipolymathStateDatabaseIfOpenAtPath(owner.path)).toBeUndefined();
      expect(kyselyCache.kyselyByDatabase.has(requireNativeSqliteDatabase(owner.db))).toBe(false);
      expect(healthy.db.isOpen).toBe(scope !== "all");
      close.mockRestore();
      expect(cache.closeOmnipolymathStateDatabaseByPath(owner.path)).toBe(true);
      expect(owner.db.isOpen).toBe(false);
      const reopened = openOmnipolymathStateDatabase({ path: owner.path });
      expect(reopened.db.prepare("SELECT value FROM retained").all()).toEqual([
        { value: "original" },
      ]);
    },
  );

  it("attempts native close and other owners after maintenance and Kysely cleanup failures", () => {
    const root = tempDirs.make("omnipolymath-state-cleanup-failures-");
    const owner = openOmnipolymathStateDatabase({ path: path.join(root, "failed.sqlite") });
    const healthy = openOmnipolymathStateDatabase({ path: path.join(root, "healthy.sqlite") });
    const maintenanceFailure = new Error("maintenance failed");
    const cacheFailure = new Error("Kysely disposal failed");
    const closeMaintenance = owner.walMaintenance.close;
    vi.spyOn(owner.walMaintenance, "close").mockImplementation((options) => {
      closeMaintenance(options);
      throw maintenanceFailure;
    });
    vi.spyOn(kyselyCache, "clearNodeSqliteKyselyCacheForDatabase").mockImplementationOnce(() => {
      throw cacheFailure;
    });
    expect(() => cache.closeOmnipolymathStateDatabase()).toThrow(
      expect.objectContaining({
        cause: maintenanceFailure,
        errors: [maintenanceFailure, cacheFailure],
      }),
    );
    expect(owner.db.isOpen).toBe(false);
    expect(healthy.db.isOpen).toBe(false);
    expect(cache.getOmnipolymathStateDatabaseIfOpenAtPath(owner.path)).toBeUndefined();
  });
});
