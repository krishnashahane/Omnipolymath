import fs from "node:fs";
import { afterEach, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import type { EngineConnection } from "../infra/sql-connection.js";
import { createSqliteWalReclamationResult } from "../infra/sqlite-wal-reclamation.js";
import { omnipolymathStateDatabaseCache } from "./omnipolymath-state-db-cache.js";
import { withOmnipolymathStateDatabaseReadOnly } from "./omnipolymath-state-db-readonly.js";
import type { DB as OmnipolymathStateKyselyDatabase } from "./omnipolymath-state-db.generated.js";
import {
  closeOmnipolymathStateDatabaseForTest,
  openOmnipolymathStateDatabase,
  runOmnipolymathStateWriteTransaction,
} from "./omnipolymath-state-db.js";

type StateDbTestDatabase = Pick<OmnipolymathStateKyselyDatabase, "diagnostic_events">;

const PROBE_SCOPE = "corruption-recovery-test";
// Incident page: the b-tree leaf replaced page 1's SQLite header (NOTADB).
const CORRUPT_PAGE_HEADER = Uint8Array.from([0x0a, 0x04, 0xc7, 0x00, 0xcb, 0x01, 0xb9, 0x00]);
const tempStateDirs = useAutoCleanupTempDirTracker(afterEach);

const fixture = () => ({
  OMNIPOLYMATH_STATE_DIR: fs.realpathSync(tempStateDirs.make("omnipolymath-state-db-corruption-")),
});

function sqliteError(message: string, errcode: number): Error {
  return Object.assign(new Error(message), { errcode });
}

function insertProbeEvent(env: NodeJS.ProcessEnv, eventKey: string): void {
  const event = { scope: PROBE_SCOPE, event_key: eventKey, payload_json: "{}", created_at: 1 };
  runOmnipolymathStateWriteTransaction(
    (database) => {
      executeSqliteQuerySync(
        database.db,
        getNodeSqliteKysely<StateDbTestDatabase>(database.db)
          .insertInto("diagnostic_events")
          .values(event),
      );
    },
    { env },
  );
}

function readProbeEventKeys(database: { db: EngineConnection }): string[] {
  const stateDb = getNodeSqliteKysely<StateDbTestDatabase>(database.db);
  const { rows } = executeSqliteQuerySync(
    database.db,
    stateDb
      .selectFrom("diagnostic_events")
      .select("event_key")
      .where("scope", "=", PROBE_SCOPE)
      .orderBy("event_key"),
  );
  return rows.map((row) => row.event_key);
}

function prepareCorruptedCachedDatabase(env: NodeJS.ProcessEnv) {
  const poisoned = openOmnipolymathStateDatabase({ env });
  const databasePath = poisoned.path;
  insertProbeEvent(env, "before-corruption");
  expect(readProbeEventKeys(poisoned)).toEqual(["before-corruption"]);

  // Bump the change counter and checkpoint: force rereading page 1 and a complete snapshot.
  const { DatabaseSync } = requireNodeSqlite();
  {
    using second = new DatabaseSync(databasePath);
    second.exec(
      `INSERT INTO diagnostic_events (scope, event_key, payload_json, created_at)
       VALUES ('${PROBE_SCOPE}', 'second-connection', '{}', 2)`,
    );
    second.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  }
  const healthySnapshot = fs.readFileSync(databasePath);
  const page = Buffer.alloc(4096);
  page.set(CORRUPT_PAGE_HEADER, 0);
  const handle = fs.openSync(databasePath, "r+");
  try {
    fs.writeSync(handle, page, 0, page.length, 0);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  // Remove cached WAL page 1 so the corrupt main file is actually read.
  fs.rmSync(`${databasePath}-wal`, { force: true });
  fs.rmSync(`${databasePath}-shm`, { force: true });
  return { databasePath, healthySnapshot, poisoned };
}

afterEach(() => closeOmnipolymathStateDatabaseForTest());
const cachedAt = (pathname: string) =>
  omnipolymathStateDatabaseCache.getOmnipolymathStateDatabaseIfOpenAtPath(pathname);

it("preserves the shared WAL when evicting a poisoned cache owner", () => {
  const env = fixture();
  const cached = openOmnipolymathStateDatabase({ env });
  insertProbeEvent(env, "committed-before-eviction");
  const walPath = `${cached.path}-wal`;
  const walBytesBeforeEviction = fs.statSync(walPath).size;
  const { DatabaseSync } = requireNodeSqlite();
  using peer = new DatabaseSync(cached.path);

  try {
    peer.exec("BEGIN;");
    peer.prepare("SELECT count(*) FROM diagnostic_events").get();
    expect(
      omnipolymathStateDatabaseCache.evictOmnipolymathStateDatabaseAfterCorruption(
        cached,
        sqliteError("database disk image is malformed", 11),
      ),
    ).toBe(true);

    expect(cachedAt(cached.path)).toBeUndefined();
    expect(fs.statSync(walPath).size).toBe(walBytesBeforeEviction);
    expect(peer.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    expect(
      peer.prepare("SELECT event_key FROM diagnostic_events WHERE scope = ?").get(PROBE_SCOPE),
    ).toEqual({ event_key: "committed-before-eviction" });
  } finally {
    peer.exec("ROLLBACK;");
  }
});

it("does not evict a different cached owner when an injected write handle fails", () => {
  const env = fixture();
  const cached = openOmnipolymathStateDatabase({ env });
  const { DatabaseSync } = requireNodeSqlite();
  using injectedDb = new DatabaseSync(":memory:");
  const injected = {
    db: injectedDb,
    path: cached.path,
    walMaintenance: {
      stop: async () => {},
      checkpoint: () => false,
      reclaimFreePages: createSqliteWalReclamationResult,
      close: () => false,
    },
  };

  expect(() =>
    runOmnipolymathStateWriteTransaction(
      () => {
        throw sqliteError("file is not a database", 26);
      },
      { database: injected },
    ),
  ).toThrow(/file is not a database/u);
  expect(cachedAt(cached.path)).toBe(cached);
  expect([cached.db.isOpen, injectedDb.isOpen]).toEqual([true, true]);
});
it.each(["write", "Kysely read", "raw read-only"])("recovers after a corrupt %s", (operation) => {
  const env = fixture();
  const { databasePath, healthySnapshot, poisoned } = prepareCorruptedCachedDatabase(env);
  expect(() => {
    if (operation === "write") {
      return insertProbeEvent(env, "during-corruption");
    }
    if (operation === "Kysely read") {
      return readProbeEventKeys(poisoned);
    }
    return withOmnipolymathStateDatabaseReadOnly(
      ({ db }) => db.prepare("SELECT count(*) AS total FROM diagnostic_events").get(),
      { env },
    );
  }).toThrow(
    expect.objectContaining({
      message: expect.stringContaining("file is not a database"),
      code: "ERR_SQLITE_ERROR",
      errcode: 26,
    }),
  );
  expect(cachedAt(databasePath)).toBeUndefined();
  fs.writeFileSync(databasePath, healthySnapshot);
  const reopened = openOmnipolymathStateDatabase({ env });
  expect(reopened).not.toBe(poisoned);
  expect(reopened.db.isOpen).toBe(true);
  expect(readProbeEventKeys(reopened)).toEqual(["before-corruption", "second-connection"]);
});
