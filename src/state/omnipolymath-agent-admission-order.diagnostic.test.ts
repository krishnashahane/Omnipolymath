// Synthetic canonical admission ordering and lifecycle proof; checks use real native SQLite.
import { fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as sqlite from "../infra/node-sqlite.js";
import { readSqliteIntegrityFileIdentity } from "../infra/sqlite-file-generation.js";
import * as integrityWorker from "../infra/sqlite-integrity-worker.js";
import * as pidAlive from "../shared/pid-alive.js";
import { disposeOmnipolymathAgentDatabaseByPath } from "./omnipolymath-agent-db-disposal.js";
import * as agentLeases from "./omnipolymath-agent-db-lease.js";
import {
  assertNoOmnipolymathAgentDatabaseLeases,
  releaseOmnipolymathAgentDatabaseLease,
} from "./omnipolymath-agent-db-lease.js";
import {
  closeOmnipolymathAgentDatabaseByPath,
  closeOmnipolymathAgentDatabasesForTest,
  closeOmnipolymathAgentDatabasesAsync,
  inspectOmnipolymathAgentDatabaseOwner,
  listOmnipolymathRegisteredAgentDatabases,
  openOmnipolymathAgentDatabase,
  withOmnipolymathAgentDatabaseAsync,
  runOmnipolymathAgentWriteTransaction,
  resolveOmnipolymathAgentSqlitePath,
} from "./omnipolymath-agent-db.js";
import { createOmnipolymathDatabaseMaintenanceScope } from "./omnipolymath-state-db-async-lifecycle.js";
import {
  closeOmnipolymathStateDatabaseForTest,
  openOmnipolymathStateDatabase,
} from "./omnipolymath-state-db.js";

// Most cases inspect one returned handle after the scoped operation, without
// competing opens. Retention tests keep their work inside the actual owner.
function openOmnipolymathAgentDatabaseAsync(
  options: Parameters<typeof openOmnipolymathAgentDatabase>[0],
  integrityCheck?: "full",
) {
  const open = () => withOmnipolymathAgentDatabaseAsync(options, (database) => database);
  return integrityCheck === "full" ? withFullIntegrity(open) : open();
}

let fullIntegrity: ReturnType<typeof createOmnipolymathDatabaseMaintenanceScope> | undefined;
function withFullIntegrity<T>(operation: () => T): T {
  fullIntegrity ??= createOmnipolymathDatabaseMaintenanceScope({ sqliteIntegrityCheck: "full" });
  return fullIntegrity.run(operation);
}

const roots: string[] = [];
const independent: DatabaseSync[] = [];
const realOpen = sqlite.openNodeSqliteDatabase;

afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of independent.splice(0)) {
    if (db.isOpen) {
      db.close();
    }
  }
  await fullIntegrity?.close();
  fullIntegrity = undefined;
  await closeOmnipolymathAgentDatabasesAsync();
  closeOmnipolymathAgentDatabasesForTest();
  closeOmnipolymathStateDatabaseForTest();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function seed(freshIdentity = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-open-order-"));
  roots.push(root);
  const options = { agentId: "synthetic-owner", env: { OMNIPOLYMATH_STATE_DIR: root } };
  openOmnipolymathStateDatabase({ env: options.env });
  const database = openOmnipolymathAgentDatabase(options);
  database.db.exec(`
    INSERT INTO memory_index_chunks
      (id,path,start_line,end_line,hash,model,text,embedding,updated_at)
      VALUES ('synthetic-parent','synthetic',1,1,'hash','synthetic','text',X'',1);
    INSERT INTO memory_index_chunk_recall_metadata (chunk_id, importance)
      VALUES ('synthetic-parent',1);
  `);
  expect(database.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  const pathname = database.path;
  closeOmnipolymathAgentDatabasesForTest();
  // Independent fixture writers revoke prior facts; scan-dependent cases request full verification.
  if (freshIdentity) {
    fs.copyFileSync(pathname, `${pathname}.replacement`);
    fs.renameSync(`${pathname}.replacement`, pathname);
  }
  agentLeases.invalidateOmnipolymathAgentDatabaseIntegrityBeforeMutation(pathname);
  const writer = realOpen(pathname);
  independent.push(writer);
  writer.exec("PRAGMA foreign_keys=OFF;");
  return { options, pathname, writer };
}

function corruptForeignKey(writer: DatabaseSync) {
  writer.exec("DELETE FROM memory_index_chunks WHERE id='synthetic-parent';");
  expect(writer.prepare("PRAGMA foreign_key_check").all()).toHaveLength(1);
}

function tracePhysicalChecks(pathname: string, commit?: () => void) {
  let completed = false;
  const events: string[] = [];
  const check = integrityWorker.runSqliteIntegrityCheckInWorkerSync;
  vi.spyOn(integrityWorker, "runSqliteIntegrityCheckInWorkerSync").mockImplementation((...args) => {
    const result = check(...args);
    if (args[0].databaseLabel === pathname) {
      events.push("integrity-completed", "foreign-key-completed");
      if (commit && !completed) {
        completed = true;
        commit();
        events.push("external-commit");
      }
    }
    return result;
  });
  vi.spyOn(sqlite, "openNodeSqliteDatabase").mockImplementation((location, options) => {
    const db = realOpen(location, options);
    if (location !== pathname) {
      return db;
    }
    const prepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      const statement = prepare(sql);
      if (
        sql === "PRAGMA integrity_check;" ||
        sql === "PRAGMA integrity_check('memory_index_chunk_recall_metadata');"
      ) {
        const all = statement.all.bind(statement);
        statement.all = () => {
          const rows = all();
          events.push("integrity-completed");
          return rows;
        };
      }
      if (
        sql === "PRAGMA foreign_key_check;" ||
        sql === "PRAGMA foreign_key_check('memory_index_chunk_recall_metadata');"
      ) {
        const iterate = statement.iterate.bind(statement);
        statement.iterate = function* () {
          yield* iterate();
          events.push("foreign-key-completed");
          if (commit && !completed) {
            completed = true;
            commit();
            events.push("external-commit");
          }
          return undefined;
        };
      }
      return statement;
    };
    return db;
  });
  return { events, didCommit: () => completed };
}

function ordinaryWrite(options: Parameters<typeof openOmnipolymathAgentDatabase>[0]) {
  return runOmnipolymathAgentWriteTransaction((database) => {
    database.db
      .prepare(
        "INSERT INTO cache_entries (scope,key,value_json,updated_at) VALUES ('synthetic','proof','{}',1)",
      )
      .run();
    return database.db
      .prepare("SELECT count(*) AS n FROM cache_entries WHERE scope='synthetic'")
      .get();
  }, options);
}

describe("physical-open admission ordering", () => {
  it("exposes and writes after an external FK violation committed after its table FK check", () => {
    const { options, pathname, writer } = seed();
    const trace = tracePhysicalChecks(pathname, () => corruptForeignKey(writer));
    const database = withFullIntegrity(() => openOmnipolymathAgentDatabase(options));
    expect(trace.events).toEqual([
      "integrity-completed",
      "foreign-key-completed",
      "external-commit",
    ]);
    expect(database.db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(1);
    expect(ordinaryWrite(options)).toEqual({ n: 1 });
  });

  it("trusts a live cached handle but rejects the same FK violation during verification after disposal", async () => {
    const { options, pathname, writer } = seed();
    const first = openOmnipolymathAgentDatabase(options);
    corruptForeignKey(writer);
    expect(openOmnipolymathAgentDatabase(options)).toBe(first);
    expect(ordinaryWrite(options)).toEqual({ n: 1 });
    expect(await disposeOmnipolymathAgentDatabaseByPath(pathname, { env: options.env })).toBe(true);
    agentLeases.invalidateOmnipolymathAgentDatabaseIntegrityBeforeMutation(pathname);
    expect(() => withFullIntegrity(() => openOmnipolymathAgentDatabase(options))).toThrow(
      /foreign_key_check failed/,
    );
  });

  it.each(["agent-id", "role", "version"] as const)(
    "rejects %s replacement before exposure, with version drift after physical checks",
    (replacement) => {
      const { options, pathname, writer } = seed(replacement !== "version");
      // Ownership is immutable once admitted; reject incompatible replacement files on load.
      if (replacement === "agent-id") {
        writer.exec("UPDATE schema_meta SET agent_id='replacement' WHERE meta_key='primary'");
      } else if (replacement === "role") {
        writer.exec("UPDATE schema_meta SET role='global' WHERE meta_key='primary'");
      }
      const trace = tracePhysicalChecks(pathname, () => writer.exec("PRAGMA user_version=9999;"));
      expect(() => withFullIntegrity(() => openOmnipolymathAgentDatabase(options))).toThrow(
        /belongs to agent replacement|schema role global|schema version 9999/,
      );
      expect(trace.didCommit()).toBe(replacement === "version");
      if (replacement !== "version") {
        expect(trace.events).toEqual([]);
      }
      expect(
        writer.prepare("SELECT count(*) AS n FROM cache_entries WHERE scope='synthetic'").get(),
      ).toEqual({ n: 0 });
    },
  );
});

describe("asynchronous canonical admission", () => {
  it("observes an independent WAL commit between the child's integrity and FK checks", async () => {
    const { pathname, writer } = seed();
    expect(writer.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    const sqliteLibraryModule = new URL("../infra/bun-sqlite-library.ts", import.meta.url).href;
    const integrityWorkerModule = new URL("../infra/sqlite-integrity.worker.ts", import.meta.url)
      .href;
    const commitBetweenChecks = `
        import { execFileSync } from "node:child_process";
        const { ensureSqliteLibrarySelected } = await import(${JSON.stringify(sqliteLibraryModule)});
        ensureSqliteLibrarySelected();
        const { DatabaseSync } = await import("node:sqlite");
        const prepare = DatabaseSync.prototype.prepare;
        DatabaseSync.prototype.prepare = function (sql) {
          const statement = prepare.call(this, sql);
          if (sql === "PRAGMA integrity_check;") {
            const all = statement.all.bind(statement);
            statement.all = () => {
              const rows = all();
              // A separate process commits before the real FK check begins.
              execFileSync(process.execPath, ["-e", ${JSON.stringify(`
                if (process.versions.bun && process.env.OMNIPOLYMATH_SQLITE_LIBRARY) {
                  require("bun:sqlite").Database.setCustomSQLite(process.env.OMNIPOLYMATH_SQLITE_LIBRARY);
                }
                const { DatabaseSync } = require("node:sqlite");
                const writer = new DatabaseSync(process.env.OMNIPOLYMATH_AGENT_DB_COMMIT_PATH);
                writer.exec("PRAGMA foreign_keys=OFF; DELETE FROM memory_index_chunks WHERE id='synthetic-parent';");
                writer.close();
              `)}], { timeout: 5000, env: process.env });
              process.send({ phase: "external-commit" });
              return rows;
            };
          }
          return statement;
        };
        await import(${JSON.stringify(integrityWorkerModule)});
      `;
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-integrity-wal-fixture-"));
    roots.push(fixtureRoot);
    const fixturePath = path.join(fixtureRoot, "worker.mts");
    fs.writeFileSync(fixturePath, commitBetweenChecks);
    const worker = fork(fixturePath, [pathname], {
      execArgv: process.versions.bun ? [] : ["--import", "tsx"],
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, OMNIPOLYMATH_AGENT_DB_COMMIT_PATH: pathname },
    });
    const closed = new Promise<void>((resolve) => {
      worker.once("close", () => resolve());
    });
    let committed = false;
    const completed = new Promise<integrityWorker.SqliteIntegrityWorkerResult>(
      (resolve, reject) => {
        let result: integrityWorker.SqliteIntegrityWorkerResult | undefined;
        worker.on(
          "message",
          (message: integrityWorker.SqliteIntegrityWorkerResult | { phase: string }) => {
            if ("phase" in message) {
              committed ||= message.phase === "external-commit";
            } else {
              result = message;
            }
          },
        );
        worker.once("error", reject);
        worker.once("close", (code) => {
          if (code === 0 && result) {
            resolve(result);
          } else {
            reject(new Error(`integrity fixture exited ${code} without its result`));
          }
        });
        worker.send(
          {
            pathname,
            databaseLabel: pathname,
            identity: readSqliteIntegrityFileIdentity(pathname),
            busyTimeoutMs: 5000,
          } satisfies integrityWorker.SqliteIntegrityWorkerInput,
          (error) => {
            if (error) {
              reject(error);
            }
          },
        );
      },
    );
    try {
      await expect(completed).resolves.toMatchObject({
        ok: false,
        error: { message: expect.stringContaining("foreign_key_check failed") },
      });
      expect(committed).toBe(true);
    } finally {
      if (worker.exitCode === null && worker.signalCode === null) {
        worker.kill("SIGKILL");
      }
      await closed;
    }
  });

  it("does not revoke another owner's pending admission while closing a registered path", async () => {
    const { options, pathname } = seed();
    const opening = openOmnipolymathAgentDatabaseAsync(options);
    expect(closeOmnipolymathAgentDatabaseByPath(pathname, "foreign-owner")).toBe(false);
    const database = await opening;
    expect(database.db.isOpen).toBe(true);
    expect(closeOmnipolymathAgentDatabaseByPath(pathname, options.agentId)).toBe(true);
    expect(database.db.isOpen).toBe(false);
  });

  it("keeps failed lease cleanup with its original agent owner", async () => {
    const { options, pathname, writer } = seed();
    const state = openOmnipolymathStateDatabase({ env: options.env });
    writer.exec("PRAGMA user_version=999;");
    state.db.exec(`CREATE TEMP TRIGGER fail_owned_release BEFORE DELETE ON agent_database_leases
      BEGIN SELECT RAISE(ABORT, 'synthetic blocked release'); END`);
    try {
      await expect(openOmnipolymathAgentDatabaseAsync(options)).rejects.toThrow(
        "synthetic blocked release",
      );
    } finally {
      state.db.exec("DROP TRIGGER fail_owned_release");
    }
    const leases = () => state.db.prepare("SELECT lease_id FROM agent_database_leases;").all();
    expect(leases()).toHaveLength(1);
    expect(closeOmnipolymathAgentDatabaseByPath(pathname, "foreign-owner")).toBe(false);
    expect(leases()).toHaveLength(1);
    closeOmnipolymathAgentDatabaseByPath(pathname, options.agentId);
    expect(leases()).toEqual([]);
  });

  it.each([null, 1])(
    "preserves process-start identity semantics across await (initial: %s)",
    async (initial) => {
      const { options } = seed();
      const identity = vi.spyOn(pidAlive, "getFileLockProcessStartTime").mockReturnValue(initial);
      const check = integrityWorker.assertSqliteIntegrityInWorker;
      vi.spyOn(integrityWorker, "assertSqliteIntegrityInWorker").mockImplementation(
        async (...args) => {
          await check(...args);
          identity.mockReturnValue(2);
        },
      );
      const opening = openOmnipolymathAgentDatabaseAsync(options, "full");
      if (initial === null) {
        await expect(opening).resolves.toMatchObject({ agentId: options.agentId });
      } else {
        await expect(opening).rejects.toThrow(/lost its runtime lease/);
      }
    },
  );

  it("rejects a lost original lease before publishing the checked handle", async () => {
    const { options, pathname } = seed();
    const state = openOmnipolymathStateDatabase({ env: options.env });
    const check = integrityWorker.assertSqliteIntegrityInWorker;
    vi.spyOn(integrityWorker, "assertSqliteIntegrityInWorker").mockImplementation(
      async (...args) => {
        await check(...args);
        const lease = state.db
          .prepare("SELECT lease_id FROM agent_database_leases WHERE path=?")
          .get(pathname);
        expect(lease).toBeDefined();
        releaseOmnipolymathAgentDatabaseLease(String(lease?.lease_id), { env: options.env });
      },
    );
    await expect(openOmnipolymathAgentDatabaseAsync(options, "full")).rejects.toThrow(
      /lost its runtime lease/,
    );
    expect(state.db.prepare("SELECT lease_id FROM agent_database_leases").all()).toEqual([]);
  });

  it.each([true])(
    "refuses physical index corruption without changing it (unrelated damage: %s)",
    async (unrelated) => {
      const { options, pathname, writer } = seed();
      writer.exec(`
      INSERT INTO cache_entries (scope,key,value_json,expires_at,updated_at)
      VALUES ('scope-a','key-a','{}',100,1);
      DROP INDEX idx_agent_cache_expiry;
      CREATE INDEX idx_agent_cache_expiry ON cache_entries(key);
    `);
      if (unrelated) {
        writer.exec(`
        CREATE TABLE unsafe_records (id INTEGER PRIMARY KEY, value TEXT, alternate TEXT);
        CREATE INDEX unsafe_records_value ON unsafe_records(value);
        INSERT INTO unsafe_records (value,alternate) VALUES ('alpha','zeta'),('beta','eta');
      `);
      }
      writer.enableDefensive?.(false);
      writer.exec("PRAGMA writable_schema=ON;");
      writer.exec(`UPDATE sqlite_schema SET sql=
      'CREATE INDEX idx_agent_cache_expiry ON cache_entries(scope, expires_at, key) WHERE expires_at IS NOT NULL'
      WHERE name='idx_agent_cache_expiry';`);
      if (unrelated) {
        writer.exec(`UPDATE sqlite_schema SET sql=
        'CREATE INDEX unsafe_records_value ON unsafe_records(alternate)'
        WHERE name='unsafe_records_value';`);
      }
      const version = Number(writer.prepare("PRAGMA schema_version").get()?.schema_version);
      writer.exec(`PRAGMA writable_schema=OFF; PRAGMA schema_version=${version + 1};`);
      const findings = writer.prepare("PRAGMA integrity_check").all();
      expect(findings).not.toEqual([{ integrity_check: "ok" }]);
      writer.close();
      await expect(openOmnipolymathAgentDatabaseAsync(options, "full")).rejects.toThrow(
        /integrity_check failed.*omnipolymath doctor --fix/,
      );
      const unchanged = realOpen(pathname, { readOnly: true });
      try {
        expect(unchanged.prepare("PRAGMA integrity_check").all()).toEqual(findings);
        expect(unchanged.prepare("SELECT key FROM cache_entries NOT INDEXED").all()).toEqual([
          { key: "key-a" },
        ]);
      } finally {
        unchanged.close();
      }
    },
  );

  it.each([false, true])("retains its state owner across await (ambient: %s)", async (ambient) => {
    const { options, pathname } = seed();
    const originalEnv = { ...options.env };
    const nextRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-open-next-owner-"));
    roots.push(nextRoot);
    const state = openOmnipolymathStateDatabase({ env: originalEnv });
    const leases = () => state.db.prepare("SELECT lease_id FROM agent_database_leases").all();
    vi.stubEnv("OMNIPOLYMATH_STATE_DIR", originalEnv.OMNIPOLYMATH_STATE_DIR);
    const check = integrityWorker.assertSqliteIntegrityInWorker;
    const worker = vi
      .spyOn(integrityWorker, "assertSqliteIntegrityInWorker")
      .mockImplementation(async (...args) => {
        const work = check(...args);
        options.env.OMNIPOLYMATH_STATE_DIR = nextRoot;
        vi.stubEnv("OMNIPOLYMATH_STATE_DIR", nextRoot);
        await work;
      });
    try {
      const opening = openOmnipolymathAgentDatabaseAsync(
        {
          agentId: options.agentId,
          path: pathname,
          ...(ambient ? {} : { env: options.env }),
        },
        "full",
      );
      await expect(opening).resolves.toMatchObject({ path: pathname });
      expect(worker).toHaveBeenCalledOnce();
      expect(leases()).toHaveLength(1);
      closeOmnipolymathAgentDatabaseByPath(pathname);
      expect(leases()).toEqual([]);
      expect(fs.readdirSync(nextRoot)).toEqual([]);
    } finally {
      options.env.OMNIPOLYMATH_STATE_DIR = originalEnv.OMNIPOLYMATH_STATE_DIR;
      vi.stubEnv("OMNIPOLYMATH_STATE_DIR", originalEnv.OMNIPOLYMATH_STATE_DIR);
      for (const lease of leases()) {
        releaseOmnipolymathAgentDatabaseLease(String(lease.lease_id), { env: originalEnv });
      }
    }
  });

  it("publishes a registered replacement database after full checks and before yielding", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-open-empty-"));
    roots.push(root);
    const options = { agentId: "synthetic-new", env: { OMNIPOLYMATH_STATE_DIR: root } };
    const original = openOmnipolymathAgentDatabase(options);
    closeOmnipolymathAgentDatabaseByPath(original.path);
    fs.renameSync(path.dirname(original.path), `${path.dirname(original.path)}-retired`);
    const pathname = resolveOmnipolymathAgentSqlitePath(options);
    const trace = tracePhysicalChecks(pathname);
    const opening = openOmnipolymathAgentDatabaseAsync(options);
    const beforeYield = {
      checks: [...trace.events],
      owner: inspectOmnipolymathAgentDatabaseOwner(pathname),
    };
    const database = await opening;
    expect(beforeYield).toEqual({
      checks: ["integrity-completed", "foreign-key-completed"],
      owner: { status: "owned", agentId: options.agentId },
    });
    expect(database.db.prepare("SELECT agent_id FROM schema_meta").get()).toEqual({
      agent_id: options.agentId,
    });
    expect(ordinaryWrite(options)).toEqual({ n: 1 });
    expect(listOmnipolymathRegisteredAgentDatabases({ env: options.env })).toEqual([
      expect.objectContaining({ agentId: options.agentId, path: database.path }),
    ]);
  });

  it("keeps a nonempty unversioned database with no application tables on async admission", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-open-retained-pages-"));
    roots.push(root);
    const options = { agentId: "synthetic-retained", env: { OMNIPOLYMATH_STATE_DIR: root } };
    const pathname = resolveOmnipolymathAgentSqlitePath(options);
    fs.mkdirSync(path.dirname(pathname), { recursive: true });
    const writer = realOpen(pathname);
    independent.push(writer);
    writer.exec(`
      CREATE TABLE retired (value BLOB);
      INSERT INTO retired VALUES (zeroblob(16384));
      DROP TABLE retired;
    `);
    expect(writer.prepare("PRAGMA user_version").get()).toEqual({ user_version: 0 });
    expect(writer.prepare("PRAGMA page_count").get()?.page_count).toBeGreaterThan(0);
    expect(
      writer.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all(),
    ).toEqual([]);
    writer.close();
    const check = vi.spyOn(integrityWorker, "assertSqliteIntegrityInWorker");
    const database = await openOmnipolymathAgentDatabaseAsync(options);
    expect(check).toHaveBeenCalledOnce();
    expect(database.agentId).toBe(options.agentId);
    expect(ordinaryWrite(options)).toEqual({ n: 1 });
  });

  it("checks an older schema before the unchanged doctor migration refusal", async () => {
    const { options, writer } = seed();
    writer.exec("PRAGMA user_version=18; UPDATE schema_meta SET schema_version=18;");
    const check = vi.spyOn(integrityWorker, "assertSqliteIntegrityInWorker");
    await expect(openOmnipolymathAgentDatabaseAsync(options)).rejects.toThrow(
      /uses schema version 18; stop active agents/,
    );
    expect(check).toHaveBeenCalledOnce();
    expect(writer.prepare("PRAGMA user_version").get()).toEqual({ user_version: 18 });
  });

  it("preserves point-in-time admission when a writer commits after the Worker check", async () => {
    const { options, writer } = seed();
    const check = integrityWorker.assertSqliteIntegrityInWorker;
    vi.spyOn(integrityWorker, "assertSqliteIntegrityInWorker").mockImplementation(
      async (...args) => {
        await check(...args);
        corruptForeignKey(writer);
      },
    );
    const database = await openOmnipolymathAgentDatabaseAsync(options, "full");
    expect(database.db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(1);
    expect(ordinaryWrite(options)).toEqual({ n: 1 });
  });

  it.each(["agent-id", "role", "version"] as const)(
    "rejects %s replacement before async exposure, with version drift after Worker completion",
    async (replacement) => {
      const { options, writer } = seed(replacement !== "version");
      if (replacement === "agent-id") {
        writer.exec("UPDATE schema_meta SET agent_id='replacement'");
      } else if (replacement === "role") {
        writer.exec("UPDATE schema_meta SET role='global'");
      }
      const check = integrityWorker.assertSqliteIntegrityInWorker;
      const worker = vi
        .spyOn(integrityWorker, "assertSqliteIntegrityInWorker")
        .mockImplementation(async (...args) => {
          await check(...args);
          writer.exec("PRAGMA user_version=9999;");
        });
      await expect(openOmnipolymathAgentDatabaseAsync(options, "full")).rejects.toThrow(
        /belongs to agent replacement|schema role global|schema version 9999/,
      );
      expect(worker).toHaveBeenCalledTimes(replacement === "version" ? 1 : 0);
      expect(() =>
        assertNoOmnipolymathAgentDatabaseLeases(options.agentId, { env: options.env }),
      ).not.toThrow();
    },
  );

  it("reopens an evicted validated database while a WAL writer remains active", async () => {
    const { options, pathname, writer } = seed();
    openOmnipolymathAgentDatabase(options);
    closeOmnipolymathAgentDatabaseByPath(pathname);
    writer.exec("BEGIN IMMEDIATE;");
    try {
      expect((await openOmnipolymathAgentDatabaseAsync(options)).db.isOpen).toBe(true);
      expect(writer.isTransaction).toBe(true);
    } finally {
      writer.exec("ROLLBACK;");
    }
    expect(ordinaryWrite(options)).toEqual({ n: 1 });
  });

  it("rejects an existing FK violation before publishing a writable handle", async () => {
    const { options, writer } = seed();
    corruptForeignKey(writer);
    await expect(openOmnipolymathAgentDatabaseAsync(options, "full")).rejects.toThrow(
      /foreign_key_check failed/,
    );
    expect(() =>
      assertNoOmnipolymathAgentDatabaseLeases(options.agentId, { env: options.env }),
    ).not.toThrow();
    expect(
      writer.prepare("SELECT count(*) AS n FROM cache_entries WHERE scope='synthetic'").get(),
    ).toEqual({ n: 0 });
  });

  it("rechecks corruption after async handle disposal", async () => {
    const { options, pathname, writer } = seed();
    await openOmnipolymathAgentDatabaseAsync(options);
    expect(await disposeOmnipolymathAgentDatabaseByPath(pathname, { env: options.env })).toBe(true);
    agentLeases.invalidateOmnipolymathAgentDatabaseIntegrityBeforeMutation(pathname);
    corruptForeignKey(writer);
    await expect(openOmnipolymathAgentDatabaseAsync(options, "full")).rejects.toThrow(
      /foreign_key_check failed/,
    );
  });

  it("joins the real read-only Worker before releasing a revoked admission lease", async () => {
    const { options, writer } = seed();
    writer.exec(
      "INSERT INTO cache_entries (scope,key,blob,updated_at) VALUES ('load','large',zeroblob(8388608),1)",
    );
    const check = integrityWorker.assertSqliteIntegrityInWorker;
    let drain: Promise<void> | undefined;
    let completed = false;
    vi.spyOn(integrityWorker, "assertSqliteIntegrityInWorker").mockImplementation((...args) => {
      const native = check(...args).finally(() => {
        completed = true;
      });
      drain = closeOmnipolymathAgentDatabasesAsync(options.env.OMNIPOLYMATH_STATE_DIR);
      expect(completed).toBe(false);
      expect(() =>
        assertNoOmnipolymathAgentDatabaseLeases(options.agentId, { env: options.env }),
      ).toThrow(/still open/);
      return native;
    });
    await expect(openOmnipolymathAgentDatabaseAsync(options, "full")).rejects.toThrow(/revoked/);
    await drain;
    expect(completed).toBe(true);
    expect(() =>
      assertNoOmnipolymathAgentDatabaseLeases(options.agentId, { env: options.env }),
    ).not.toThrow();
    writer.exec("BEGIN IMMEDIATE; ROLLBACK;");
  });

  it.each([false, true])(
    "preserves a synchronous replacement when old async close fails=%s",
    async (failClose) => {
      const { options, pathname, writer } = seed();
      writer.exec(
        "INSERT INTO cache_entries (scope,key,blob,updated_at) VALUES ('load','large',zeroblob(8388608),1)",
      );
      const check = integrityWorker.assertSqliteIntegrityInWorker;
      let source: DatabaseSync | undefined;
      let replacement: ReturnType<typeof openOmnipolymathAgentDatabase> | undefined;
      vi.spyOn(sqlite, "openNodeSqliteDatabase").mockImplementation((location, dbOptions) => {
        const db = realOpen(location, dbOptions);
        if (location === pathname && !source) {
          source = db;
        }
        return db;
      });
      vi.spyOn(integrityWorker, "assertSqliteIntegrityInWorker").mockImplementation((...args) => {
        const native = check(...args);
        replacement = openOmnipolymathAgentDatabase(options);
        if (failClose && source) {
          const close = source.close.bind(source);
          let failed = false;
          source.close = () => {
            if (!failed) {
              failed = true;
              throw new Error("synthetic native close failure");
            }
            close();
          };
        }
        return native;
      });
      await expect(openOmnipolymathAgentDatabaseAsync(options, "full")).rejects.toThrow(
        failClose ? /synthetic native close failure/ : /revoked/,
      );
      expect(replacement?.db.isOpen).toBe(true);
      expect(openOmnipolymathAgentDatabase(options)).toBe(replacement);
      expect(ordinaryWrite(options)).toEqual({ n: 1 });
      expect(source?.isOpen).toBe(failClose);
      expect(closeOmnipolymathAgentDatabaseByPath(pathname)).toBe(true);
      expect(source?.isOpen).toBe(false);
      expect(() =>
        assertNoOmnipolymathAgentDatabaseLeases(options.agentId, { env: options.env }),
      ).not.toThrow();
    },
  );
});

describe("failed-open cleanup ownership", () => {
  it.each(["sync", "async"] as const)(
    "retains the original failed lease release for retry (%s)",
    async (mode) => {
      const { options, pathname } = seed();
      const originalEnv = { ...options.env };
      const state = openOmnipolymathStateDatabase({ env: originalEnv });
      const rows = () => state.db.prepare("SELECT lease_id FROM agent_database_leases;").all();
      const release = vi.spyOn(agentLeases, "releaseOmnipolymathAgentDatabaseLease");
      release.mockImplementation(() => {
        throw new Error("synthetic lease release failure");
      });
      const closeFailure = {
        message: "Agent database close failed",
        errors: expect.arrayContaining([
          expect.objectContaining({ message: "synthetic lease release failure" }),
        ]),
      };
      if (mode === "sync") {
        expect(() =>
          openOmnipolymathAgentDatabase({ ...options, agentId: "other-owner", path: pathname }),
        ).toThrow("synthetic lease release failure");
      } else {
        const admission = openOmnipolymathAgentDatabaseAsync(options, "full");
        await Promise.all([
          expect(admission).rejects.toThrow("synthetic lease release failure"),
          expect(closeOmnipolymathAgentDatabasesAsync()).rejects.toMatchObject(closeFailure),
        ]);
      }
      expect(rows()).toHaveLength(1);
      const originalLease = rows()[0];
      const nextRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-close-next-owner-"));
      roots.push(nextRoot);
      options.env.OMNIPOLYMATH_STATE_DIR = nextRoot;
      await expect(closeOmnipolymathAgentDatabasesAsync()).rejects.toMatchObject(closeFailure);
      expect(rows()).toEqual([originalLease]);
      release.mockRestore();
      await closeOmnipolymathAgentDatabasesAsync();
      expect(rows()).toEqual([]);
      expect(fs.readdirSync(nextRoot)).toEqual([]);
    },
  );
});

it("checks the original lease while another shared-state WAL writer is active", () => {
  const { options } = seed();
  const database = openOmnipolymathAgentDatabase(options);
  const state = openOmnipolymathStateDatabase({ env: options.env });
  const row = state.db.prepare("SELECT lease_id FROM agent_database_leases;").get() as {
    lease_id: string;
  };
  const blocker = realOpen(state.path);
  independent.push(blocker);
  blocker.exec("BEGIN IMMEDIATE;");
  try {
    expect(() =>
      agentLeases.assertOmnipolymathAgentDatabaseLease(row.lease_id, {
        agentId: database.agentId,
        path: database.path,
        env: options.env,
      }),
    ).not.toThrow();
  } finally {
    blocker.exec("ROLLBACK;");
  }
});

it("joins only the pending admissions in the closing runtime root", async () => {
  const first = seed();
  const second = seed();
  const firstOpen = openOmnipolymathAgentDatabaseAsync(first.options);
  const rejected = expect(firstOpen).rejects.toThrow("revoked");
  const secondOpen = openOmnipolymathAgentDatabaseAsync(second.options);
  await closeOmnipolymathAgentDatabasesAsync(first.options.env.OMNIPOLYMATH_STATE_DIR);
  await rejected;
  const secondDatabase = await secondOpen;
  expect(secondDatabase.db.isOpen).toBe(true);
  expect(ordinaryWrite(second.options)).toEqual({ n: 1 });
  const leases = (options: typeof first.options) =>
    openOmnipolymathStateDatabase({ env: options.env })
      .db.prepare("SELECT lease_id FROM agent_database_leases;")
      .all();
  expect(leases(first.options)).toEqual([]);
  expect(leases(second.options)).toHaveLength(1);
});
