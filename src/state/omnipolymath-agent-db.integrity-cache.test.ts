import fs from "node:fs";
import path from "node:path";
import { DatabaseSync as NativeDatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { writeSessionEntry } from "../config/sessions/session-accessor.sqlite-entry-store.js";
import * as sqlite from "../infra/node-sqlite.js";
import {
  readSqliteCleanCloseSeal,
  writeSqliteCleanCloseSeal,
} from "../infra/sqlite-clean-close-seal.js";
import {
  readSqliteDatabaseCleanClose,
  readSqliteDatabaseIntegrityVerification,
  retireSqliteDatabaseAdmissionForPath,
} from "../infra/sqlite-database-admission.js";
import * as integrityWorker from "../infra/sqlite-integrity-worker.js";
import type { SqliteIntegrityDiagnostics } from "../infra/sqlite-integrity.js";
import {
  beginGatewayShutdownCleanup,
  markGatewayRestartDraining,
  resetGatewayWorkAdmission,
} from "../process/gateway-work-admission.js";
import { createDeferredCore } from "../shared/deferred.js";
import {
  claimOmnipolymathAgentDatabaseLease,
  invalidateOmnipolymathAgentDatabaseIntegrityBeforeMutation,
  releaseOmnipolymathAgentDatabaseLease,
} from "./omnipolymath-agent-db-lease.js";
import { closeCachedOmnipolymathAgentDatabase } from "./omnipolymath-agent-db-lifecycle.js";
import { openOmnipolymathAgentDatabaseReadOnly } from "./omnipolymath-agent-db-readonly.js";
import * as schema from "./omnipolymath-agent-db-schema.js";
import {
  closeOmnipolymathAgentDatabaseByPath,
  closeOmnipolymathAgentDatabasesAsync,
  closeOmnipolymathAgentDatabasesForTest,
  openOmnipolymathAgentDatabase,
  resolveOmnipolymathAgentSqlitePath,
  runOmnipolymathAgentWriteTransaction,
  withOmnipolymathAgentDatabaseAdmission,
  withOmnipolymathAgentDatabaseAsync,
} from "./omnipolymath-agent-db.js";
import { sqliteDatabaseSealSchemaFor } from "./omnipolymath-database-seal-schema.js";
import { createOmnipolymathDatabaseMaintenanceScope } from "./omnipolymath-state-db-async-lifecycle.js";
import {
  closeOmnipolymathStateDatabaseForTest,
  openOmnipolymathStateDatabase,
} from "./omnipolymath-state-db.js";
import { resolveQuarantineStorePath } from "./omnipolymath-state-db.paths.js";
import { createUnsafeIndexDrift } from "./sqlite-index-drift.test-support.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const logger = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("../logging/subsystem.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../logging/subsystem.js")>();
  return {
    ...actual,
    createSubsystemLogger: (name: string) => {
      const original = actual.createSubsystemLogger(name);
      return name === "state/agent-db" ? { ...original, info: logger.info } : original;
    },
  };
});

afterEach(async () => {
  vi.restoreAllMocks();
  logger.info.mockClear();
  await closeOmnipolymathAgentDatabasesAsync();
  closeOmnipolymathAgentDatabasesForTest();
  closeOmnipolymathStateDatabaseForTest();
});

it.each([false, true])("defers seal-less Doctor reopens (pinned WAL: %s)", async (pinned) => {
  const options = {
    agentId: "doctor",
    env: { OMNIPOLYMATH_STATE_DIR: tempDirs.make("agent-doctor-reopen-") },
  };
  const seeded = openOmnipolymathAgentDatabase(options);
  closeOmnipolymathAgentDatabasesForTest();
  retireSqliteDatabaseAdmissionForPath(seeded.path);
  fs.unlinkSync(`${seeded.path}.seal`);
  const gate = schema.agentDatabaseIntegrityBeforeMutationSteps;
  const diagnostics: SqliteIntegrityDiagnostics[] = [];
  let checks = 0;
  vi.spyOn(schema, "agentDatabaseIntegrityBeforeMutationSteps").mockImplementation(function* (
    ...args
  ) {
    for (const check of gate(...args)) {
      checks += 1;
      yield check;
    }
    diagnostics.push({ ...args[3]?.diagnostics });
    return false;
  });
  const maintenance = createOmnipolymathDatabaseMaintenanceScope({ sqliteIntegrityCheck: "quick" });
  let reader: ReturnType<typeof sqlite.openNodeSqliteDatabase> | undefined;
  try {
    await maintenance.run(async () => {
      const first = openOmnipolymathAgentDatabase(options);
      if (pinned) {
        reader = sqlite.openNodeSqliteDatabase(first.path, { readOnly: true });
        reader.exec("BEGIN");
        reader.prepare("SELECT * FROM auth_profile_state").all();
        first.db.exec("INSERT INTO auth_profile_state VALUES ('pinned', '{}', 1)");
      }
      closeCachedOmnipolymathAgentDatabase(first);
      expect(readSqliteDatabaseCleanClose(first.path)).toBe(false);
      expect(readSqliteDatabaseIntegrityVerification(first.path)).toBeUndefined();
      await withOmnipolymathAgentDatabaseAdmission(
        options,
        (run) => Promise.resolve(run(() => {})),
        (second) => expect(second.db.isOpen).toBe(true),
      );
      expect(checks).toBe(0);
      expect(diagnostics).toEqual([
        expect.objectContaining({ integrityGateMode: "deferred", integrityGateOutcome: "pending" }),
        expect.objectContaining({ integrityGateOutcome: "cached" }),
      ]);
      expect(diagnostics.every((record) => record.integrityCheckSyncMs === undefined)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        `agent database clean-close receipt: ${pinned ? "checkpoint-incomplete" : "verification-missing"}; agent=doctor`,
        expect.anything(),
      );
    });
  } finally {
    reader?.close();
    await maintenance.close();
  }
});

it.each([
  "missing",
  "doctor",
  "unique",
  "missing-unique",
  "pending-column",
  "trigger",
  "full",
] as const)("limits additive index admission to non-unique repairs (%s)", async (difference) => {
  const options = {
    agentId: "index-upgrade",
    env: { OMNIPOLYMATH_STATE_DIR: tempDirs.make("agent-index-upgrade-") },
  };
  const original = openOmnipolymathAgentDatabase(options);
  original.db.exec("INSERT INTO auth_profile_state VALUES ('preserved', '{}', 1)");
  closeOmnipolymathAgentDatabasesForTest();
  const seal = readSqliteCleanCloseSeal(
    original.path,
    fs.statSync(original.path, { bigint: true }),
  )!;
  retireSqliteDatabaseAdmissionForPath(original.path);
  const indexes = [
    "idx_agent_conversation_deliveries_source_session",
    "idx_agent_session_input_completions_session_key",
  ];
  {
    using previous = new NativeDatabaseSync(original.path);
    for (const index of difference === "missing" ? indexes.slice(0, 1) : indexes) {
      previous.exec(`DROP INDEX ${index}`);
    }
    if (difference === "missing-unique") {
      previous.exec("DROP INDEX idx_agent_conversations_identity");
    }
    if (difference === "unique") {
      previous.exec("CREATE UNIQUE INDEX unexpected ON auth_profile_state(updated_at)");
    }
    if (difference === "pending-column") {
      previous.exec("ALTER TABLE session_windows DROP COLUMN row_transcript_updated_at");
    }
    if (difference === "trigger") {
      previous.exec(
        "CREATE TRIGGER unexpected AFTER INSERT ON auth_profile_state BEGIN SELECT 1; END",
      );
    }
    previous.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
  // Model a clean prior-build close whose canonical catalog predates the indexes.
  expect(
    writeSqliteCleanCloseSeal(
      original.path,
      "prior-index-catalog",
      fs.statSync(original.path, { bigint: true }),
      {
        ...seal,
        identity: {
          ...sqliteDatabaseSealSchemaFor("agent")!.identity,
          schema: "prior-index-catalog",
        },
      },
    ),
  ).toBe(true);
  const priorSealBytes = fs.readFileSync(`${original.path}.seal`, "utf8");
  const gate = schema.agentDatabaseIntegrityBeforeMutationSteps;
  let checks = 0;
  let diagnostics: SqliteIntegrityDiagnostics | undefined;
  vi.spyOn(schema, "agentDatabaseIntegrityBeforeMutationSteps").mockImplementation(function* (
    ...args
  ) {
    const operation = gate(...args);
    let step = operation.next();
    while (!step.done) {
      checks++;
      yield step.value;
      step = operation.next();
    }
    diagnostics = args[3]?.diagnostics;
    return step.value;
  });
  const reopen = () => openOmnipolymathAgentDatabase(options);
  if (difference === "unique" || difference === "trigger") {
    expect(reopen).toThrow();
  } else if (difference === "full" || difference === "doctor") {
    const maintenance = createOmnipolymathDatabaseMaintenanceScope({
      sqliteIntegrityCheck: difference === "full" ? "full" : "quick",
    });
    try {
      maintenance.run(reopen);
    } finally {
      await maintenance.close();
    }
  } else {
    const opened = reopen();
    expect(
      opened.db
        .prepare("SELECT state_json FROM auth_profile_state WHERE state_key='preserved'")
        .get(),
    ).toEqual({ state_json: "{}" });
    expect(
      opened.db
        .prepare("SELECT name FROM sqlite_schema WHERE name IN (?, ?) ORDER BY name")
        .all(...indexes),
    ).toEqual(indexes.map((name) => ({ name })));
  }
  const bounded = difference === "missing" || difference === "doctor";
  expect(checks).toBe(bounded ? 0 : 1);
  if (bounded) {
    expect(diagnostics).toMatchObject({
      integrityGateMode: "deferred",
      integrityGateOutcome: "pending",
      repairedIndexCount: difference === "missing" ? 1 : 2,
    });
    expect(diagnostics?.integrityCheckSyncMs).toBeUndefined();
    expect(readSqliteDatabaseIntegrityVerification(original.path)).toBeUndefined();
    closeOmnipolymathAgentDatabasesForTest();
    expect(readSqliteDatabaseCleanClose(original.path)).toBe(false);
    expect(fs.readFileSync(`${original.path}.seal`, "utf8")).toBe(priorSealBytes);
  }
});

it("certifies shutdown handles after dependent readers and final borrowers release", async () => {
  vi.useFakeTimers();
  const env = { OMNIPOLYMATH_STATE_DIR: tempDirs.make("omnipolymath-cleanup-idle-") };
  const options = { agentId: "idle", env };
  const heldOptions = { agentId: "held", env };
  const idle = openOmnipolymathAgentDatabase(options);
  const reader = openOmnipolymathAgentDatabaseReadOnly(options, { lifecycle: "agent" });
  if (!reader.found) {
    throw new Error("Missing synthetic agent reader");
  }
  reader.database.db.prepare("SELECT state_key FROM auth_profile_state").all();
  idle.db.exec("INSERT INTO auth_profile_state VALUES ('shutdown-proof', '{}', 1)");
  const held = openOmnipolymathAgentDatabase(heldOptions);
  const entered = createDeferredCore();
  const release = createDeferredCore();
  const borrowed = withOmnipolymathAgentDatabaseAsync(heldOptions, async (database) => {
    entered.resolve();
    await release.promise;
    expect(database.db.prepare("SELECT 1 AS value").get()).toEqual({ value: 1 });
  });
  try {
    await entered.promise;
    markGatewayRestartDraining();
    await vi.advanceTimersByTimeAsync(0);
    expect(idle.db.isOpen).toBe(true);
    beginGatewayShutdownCleanup();
    await vi.advanceTimersByTimeAsync(0);
    expect(idle.db.isOpen).toBe(true);
    reader.database.close();
    await vi.waitFor(() => expect(idle.db.isOpen).toBe(false));
    expect(reader.database.db.isOpen).toBe(false);
    expect(readSqliteDatabaseCleanClose(idle.path)).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      "agent database clean-close receipt: written; agent=idle",
      expect.objectContaining({ agentId: "idle", receipt: "written" }),
    );
    expect(held.db.isOpen).toBe(true);
    expect(readSqliteDatabaseCleanClose(held.path)).toBe(false);
    release.resolve();
    await borrowed;
    await vi.advanceTimersByTimeAsync(0);
    expect(held.db.isOpen).toBe(false);
    expect(readSqliteDatabaseCleanClose(held.path)).toBe(true);
    await withOmnipolymathAgentDatabaseAsync(options, async (reopened) => {
      await Promise.resolve();
      expect(reopened.db.isOpen).toBe(true);
      reopened.db.exec("INSERT INTO auth_profile_state VALUES ('seal-reopen', '{}', 1)");
      expect(readSqliteDatabaseCleanClose(idle.path)).toBe(false);
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(readSqliteDatabaseCleanClose(idle.path)).toBe(true);
  } finally {
    release.resolve();
    await borrowed;
    resetGatewayWorkAdmission();
    vi.useRealTimers();
  }
});

it.each([
  "unchanged",
  "legacy-matching",
  "legacy-components-matching",
  "no-proof",
  "malformed-proof",
  "malformed-identity",
  "identity-mismatch",
  "runtime-change",
  "sqlite-change",
  "feature-mismatch",
  "schema-mismatch",
  "policy-mismatch",
] as const)("reports the next admission's clean-close proof outcome (%s)", (outcome) => {
  const options = {
    agentId: "receipt-agent",
    env: { OMNIPOLYMATH_STATE_DIR: tempDirs.make("agent-seal-reason-") },
  };
  const first = openOmnipolymathAgentDatabase(options);
  first.db.exec("INSERT INTO auth_profile_state VALUES ('preserved', '{}', 1)");
  closeOmnipolymathAgentDatabasesForTest();
  const file = fs.statSync(first.path, { bigint: true });
  const seal = readSqliteCleanCloseSeal(first.path, file)!;
  expect(seal).toBeDefined();
  // Drop process custody so admission must consume the on-disk restart proof.
  retireSqliteDatabaseAdmissionForPath(first.path);
  if (outcome === "no-proof") {
    fs.unlinkSync(`${first.path}.seal`);
  } else if (outcome === "malformed-proof") {
    fs.writeFileSync(`${first.path}.seal`, "{torn");
  } else if (outcome !== "unchanged") {
    const identity = structuredClone(sqliteDatabaseSealSchemaFor("agent")!.identity);
    if (outcome === "runtime-change") {
      identity.runtime = '["other-runtime",null]';
    } else if (outcome === "sqlite-change") {
      identity.sqlite.version = "3.54.0";
      identity.sqlite.sourceId = "prior-source";
    } else if (outcome === "feature-mismatch") {
      identity.runtime = '["other-runtime",null]';
      identity.sqlite.compileOptions += ",OMIT_JSON";
    } else if (outcome === "schema-mismatch") {
      identity.runtime = '["other-runtime",null]';
      identity.schema = "other-schema";
    } else if (outcome === "policy-mismatch") {
      identity.runtime = '["other-runtime",null]';
      identity.policy -= 1;
    }
    expect(
      writeSqliteCleanCloseSeal(
        first.path,
        outcome.startsWith("legacy-") ? seal.schemaIdentity : "other-identity",
        file,
        {
          ...seal,
          identity:
            outcome === "legacy-matching" || outcome === "identity-mismatch"
              ? undefined
              : outcome === "legacy-components-matching"
                ? { ...identity, sqlite: "legacy-combined-hash" }
                : outcome === "malformed-identity"
                  ? { ...identity, sqlite: { version: "3.54.0" } }
                  : identity,
        },
      ),
    ).toBe(true);
  }
  const statements: string[] = [];
  const open = sqlite.openNodeSqliteDatabase;
  vi.spyOn(sqlite, "openNodeSqliteDatabase").mockImplementation((...args) => {
    const database = open(...args);
    const prepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation((sql) => {
      statements.push(sql);
      return prepare(sql);
    });
    return database;
  });
  logger.info.mockClear();
  const reopened = openOmnipolymathAgentDatabase(options);
  expect(
    reopened.db
      .prepare("SELECT state_key FROM auth_profile_state WHERE state_key='preserved'")
      .get(),
  ).toEqual({ state_key: "preserved" });
  if (
    [
      "unchanged",
      "legacy-matching",
      "legacy-components-matching",
      "runtime-change",
      "sqlite-change",
    ].includes(outcome)
  ) {
    expect(statements.filter((sql) => /PRAGMA (?:integrity|quick)_check/i.test(sql))).toEqual([]);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining("agent database integrity gate"),
      expect.anything(),
    );
    expect(readSqliteDatabaseCleanClose(first.path)).toBe(true);
    closeOmnipolymathAgentDatabasesForTest();
    const reminted = readSqliteCleanCloseSeal(
      first.path,
      fs.statSync(first.path, { bigint: true }),
    )!;
    expect(reminted.verifiedAt).toBe(seal.verifiedAt);
    expect(reminted.identity).toEqual(sqliteDatabaseSealSchemaFor("agent")!.identity);
    retireSqliteDatabaseAdmissionForPath(first.path);
    statements.length = 0;
    openOmnipolymathAgentDatabase(options);
    expect(readSqliteDatabaseCleanClose(first.path)).toBe(true);
    expect(statements.filter((sql) => /PRAGMA (?:integrity|quick)_check/i.test(sql))).toEqual([]);
  } else {
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("outcome=pending"),
      expect.objectContaining({
        agentId: "receipt-agent",
        integrityGateReason: outcome === "malformed-identity" ? "malformed-proof" : outcome,
        integrityGateMode: "deferred",
        integrityGateOutcome: "pending",
      }),
    );
    expect(readSqliteDatabaseIntegrityVerification(reopened.path)).toBeUndefined();
    expect(readSqliteDatabaseCleanClose(first.path)).toBe(false);
  }
});

it("retains admission through pinned WAL eviction and certifies the final checkpointed close", async () => {
  const options = {
    agentId: "main",
    env: { OMNIPOLYMATH_STATE_DIR: tempDirs.make("omnipolymath-integrity-pinned-") },
  };
  const pathname = resolveOmnipolymathAgentSqlitePath(options);
  let checks = 0;
  const open = sqlite.openNodeSqliteDatabase;
  vi.spyOn(sqlite, "openNodeSqliteDatabase").mockImplementation((...args) => {
    const database = open(...args);
    if (args[0] === pathname) {
      const prepare = database.prepare.bind(database);
      vi.spyOn(database, "prepare").mockImplementation((sql) => {
        if (/^PRAGMA integrity_check(?:\('sqlite_schema'\))?;?$/.test(sql)) {
          checks += 1;
        }
        return prepare(sql);
      });
    }
    return database;
  });
  const worker = vi.spyOn(integrityWorker, "assertSqliteIntegrityInWorker");
  const write = (updatedAt: number) =>
    runOmnipolymathAgentWriteTransaction(
      (database) =>
        writeSessionEntry(database, "agent:main:integrity", { sessionId: "retained", updatedAt }),
      options,
    );
  write(1);
  const reader = open(pathname, { readOnly: true });
  try {
    reader.exec("BEGIN");
    reader.prepare("SELECT updated_at FROM session_nodes").all();
    for (let iteration = 2; iteration <= 9; iteration += 1) {
      write(iteration);
      const database = openOmnipolymathAgentDatabase(options);
      closeCachedOmnipolymathAgentDatabase(database);
      expect(database.db.isOpen).toBe(false);
      await withOmnipolymathAgentDatabaseAsync(options, (reopened) => {
        expect(reopened.db.prepare("SELECT updated_at FROM session_nodes").get()).toEqual({
          updated_at: iteration,
        });
      });
    }
    expect(checks + worker.mock.calls.length).toBe(1);
  } finally {
    reader.close();
  }
  closeOmnipolymathAgentDatabasesForTest();
  expect(readSqliteDatabaseCleanClose(pathname)).toBe(true);
  openOmnipolymathAgentDatabase(options);
  expect(checks + worker.mock.calls.length).toBe(1);
});

it("checks once across writes and physical admitted reopens, including after lifecycle reset", async () => {
  const options = {
    agentId: "integrity-cache",
    env: { OMNIPOLYMATH_STATE_DIR: tempDirs.make("omnipolymath-integrity-cache-") },
  };
  const pathname = resolveOmnipolymathAgentSqlitePath(options);
  const checks: string[] = [];
  const open = sqlite.openNodeSqliteDatabase;
  vi.spyOn(sqlite, "openNodeSqliteDatabase").mockImplementation((...args) => {
    const database = open(...args);
    if (args[0] === pathname) {
      const prepare = database.prepare.bind(database);
      vi.spyOn(database, "prepare").mockImplementation((sql) => {
        if (/^PRAGMA (integrity_check|foreign_key_check)(?:\('sqlite_schema'\))?;$/.test(sql)) {
          checks.push(sql);
        }
        return prepare(sql);
      });
    }
    return database;
  });
  const worker = vi.spyOn(integrityWorker, "assertSqliteIntegrityInWorker");
  const first = openOmnipolymathAgentDatabase(options);
  expect(checks).toEqual(["PRAGMA integrity_check;", "PRAGMA foreign_key_check;"]);
  first.db.exec("INSERT INTO auth_profile_state VALUES ('preserved', '{\"value\":42}', 1)");
  for (let iteration = 0; iteration < 2; iteration += 1) {
    closeOmnipolymathAgentDatabaseByPath(pathname);
    const read = (database: typeof first) =>
      database.db
        .prepare("SELECT state_json FROM auth_profile_state WHERE state_key = ?")
        .get("preserved");
    const row = await withOmnipolymathAgentDatabaseAdmission(
      options,
      (run) => Promise.resolve(run(() => {})),
      read,
    );
    expect(row).toEqual({ state_json: '{"value":42}' });
  }
  expect(checks).toEqual(["PRAGMA integrity_check;", "PRAGMA foreign_key_check;"]);
  expect(worker).not.toHaveBeenCalled();

  closeOmnipolymathAgentDatabasesForTest();
  openOmnipolymathAgentDatabase(options);
  expect(checks).toEqual(["PRAGMA integrity_check;", "PRAGMA foreign_key_check;"]);
});

it("explicit full maintenance refuses an orphan allocated page before admission", async () => {
  const expected = /never used/iu;
  const options = {
    agentId: "integrity-pages",
    env: { OMNIPOLYMATH_STATE_DIR: tempDirs.make("omnipolymath-integrity-pages-") },
  };
  const pathname = openOmnipolymathAgentDatabase(options).path;
  closeOmnipolymathAgentDatabasesForTest();
  invalidateOmnipolymathAgentDatabaseIntegrityBeforeMutation(pathname);
  const database = sqlite.openNodeSqliteDatabase(pathname);
  try {
    database.enableDefensive?.(false);
    database.exec(`
      CREATE TABLE page_owner_a (value INTEGER);
      CREATE TABLE page_owner_b (value INTEGER);
      INSERT INTO page_owner_a VALUES (1);
      INSERT INTO page_owner_b VALUES (2);
      PRAGMA writable_schema = ON;
    `);
    database.exec("DELETE FROM sqlite_schema WHERE name = 'page_owner_b';");
    const version = Number(database.prepare("PRAGMA schema_version").get()?.schema_version);
    database.exec(`PRAGMA writable_schema = OFF; PRAGMA schema_version = ${version + 1};`);

    // Every table can be sound while global page ownership is corrupt.
    const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all();
    for (const table of [{ name: "sqlite_schema" }, ...tables]) {
      const name = String(table.name).replaceAll("'", "''");
      expect(database.prepare(`PRAGMA integrity_check('${name}')`).all()).toEqual([
        { integrity_check: "ok" },
      ]);
    }
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(String(database.prepare("PRAGMA integrity_check").get()?.integrity_check)).toMatch(
      expected,
    );
  } finally {
    database.close();
  }

  const admitted = vi.fn();
  const maintenance = createOmnipolymathDatabaseMaintenanceScope({ sqliteIntegrityCheck: "full" });
  try {
    await expect(
      maintenance.run(() =>
        withOmnipolymathAgentDatabaseAdmission(
          options,
          (run) => Promise.resolve(run(() => {})),
          admitted,
        ),
      ),
    ).rejects.toMatchObject({
      name: "SqliteIntegrityError",
      message: expect.stringMatching(expected),
    });
    expect(admitted).not.toHaveBeenCalled();
  } finally {
    await maintenance.close();
  }
});

it("does not lend remembered integrity to explicit verification of a replacement file", async () => {
  const options = {
    agentId: "integrity-cache",
    env: { OMNIPOLYMATH_STATE_DIR: tempDirs.make("omnipolymath-integrity-replacement-") },
  };
  const database = openOmnipolymathAgentDatabase(options);
  closeOmnipolymathAgentDatabaseByPath(database.path);
  const replacement = `${database.path}.replacement`;
  fs.copyFileSync(database.path, replacement);
  createUnsafeIndexDrift(replacement);
  fs.renameSync(replacement, database.path);
  const maintenance = createOmnipolymathDatabaseMaintenanceScope({ sqliteIntegrityCheck: "full" });
  try {
    expect(() => maintenance.run(() => openOmnipolymathAgentDatabase(options))).toThrow(
      /integrity_check failed.*missing from index unsafe_index_records_value/iu,
    );
  } finally {
    await maintenance.close();
  }
});

it("rechecks the media version guard after a validated handle is replaced by a populated v0 store", () => {
  const env = { OMNIPOLYMATH_STATE_DIR: tempDirs.make("agent-media-replacement-") };
  const databasePath = openOmnipolymathAgentDatabase({ agentId: "worker-1", env }).path;
  expect(closeOmnipolymathAgentDatabaseByPath(databasePath)).toBe(true);

  fs.copyFileSync(databasePath, `${databasePath}.replacement`);
  fs.renameSync(`${databasePath}.replacement`, databasePath);
  const { DatabaseSync } = sqlite.requireNodeSqlite();
  const downgraded = new DatabaseSync(databasePath);
  try {
    downgraded.exec(`
      PRAGMA user_version = 0;
      UPDATE schema_meta SET schema_version = 0 WHERE meta_key = 'primary';
    `);
  } finally {
    downgraded.close();
  }

  expect(() => openOmnipolymathAgentDatabase({ agentId: "worker-1", env })).toThrow(
    "run omnipolymath doctor --fix to migrate persisted media",
  );
});

it.each(["invalid seal", "foreign lease"] as const)(
  "keeps current-schema admission bounded with an invalid seal or foreign lease (%s)",
  (change) => {
    const env = { OMNIPOLYMATH_STATE_DIR: tempDirs.make("agent-integrity-policy-") };
    const options = { agentId: "policy", env };
    const original = openOmnipolymathAgentDatabase(options);
    original.db.exec("INSERT INTO auth_profile_state VALUES ('preserved', '{\"ok\":true}', 1)");
    closeOmnipolymathAgentDatabaseByPath(original.path);
    expect(readSqliteDatabaseCleanClose(original.path)).toBe(true);
    const lease =
      change === "foreign lease"
        ? claimOmnipolymathAgentDatabaseLease({ ...options, path: original.path })
        : undefined;
    try {
      if (lease) {
        openOmnipolymathStateDatabase({ env })
          .db.prepare(
            "UPDATE agent_database_leases SET owner_pid = ?, owner_start_time = NULL WHERE lease_id = ?",
          )
          .run(process.ppid, lease);
      } else {
        fs.writeFileSync(`${original.path}.seal`, "torn next-startup seal");
      }
      const gate = schema.agentDatabaseIntegrityBeforeMutationSteps;
      let diagnostics: SqliteIntegrityDiagnostics | undefined;
      vi.spyOn(schema, "agentDatabaseIntegrityBeforeMutationSteps").mockImplementation(function* (
        ...args
      ) {
        const result = yield* gate(...args);
        diagnostics = args[3]?.diagnostics;
        return result;
      });
      logger.info.mockClear();
      const reopened = openOmnipolymathAgentDatabase(options);
      expect(
        reopened.db
          .prepare("SELECT state_json FROM auth_profile_state WHERE state_key='preserved'")
          .get(),
      ).toEqual({ state_json: '{"ok":true}' });
      expect(diagnostics?.integrityGateOutcome).toBe(lease ? "pending" : "cached");
      reopened.db.exec("UPDATE auth_profile_state SET updated_at=2 WHERE state_key='preserved'");
      expect(readSqliteDatabaseCleanClose(original.path)).toBe(false);
    } finally {
      if (lease) {
        releaseOmnipolymathAgentDatabaseLease(lease, { env }, "read-only");
      }
    }
  },
);

it("adopts the released quarantine schema without changing its rows or version", () => {
  const env = { OMNIPOLYMATH_STATE_DIR: tempDirs.make("agent-integrity-upgrade-") };
  const storePath = resolveQuarantineStorePath(env);
  const quarantinedPath = path.join(env.OMNIPOLYMATH_STATE_DIR, "retained.sqlite");
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const previous = sqlite.openNodeSqliteDatabase(storePath);
  try {
    // The quarantine schema shipped in v2026.9.5 has no integrity-receipt table.
    previous.exec(`
      CREATE TABLE quarantined_databases (
        path TEXT NOT NULL PRIMARY KEY,
        kind TEXT NOT NULL,
        reason TEXT NOT NULL,
        quarantined_at INTEGER NOT NULL,
        writer_app_version TEXT,
        verified_generation TEXT
      ) STRICT;
      PRAGMA user_version = 2;
    `);
    previous
      .prepare("INSERT INTO quarantined_databases VALUES (?, ?, ?, ?, ?, ?)")
      .run(quarantinedPath, "agent", "retained quarantine", 1, "2026.9.5", null);
  } finally {
    previous.close();
  }

  const database = openOmnipolymathAgentDatabase({ agentId: "upgraded", env });
  expect(readSqliteDatabaseCleanClose(database.path)).toBe(false);
  const upgraded = sqlite.openNodeSqliteDatabase(storePath, { readOnly: true });
  try {
    expect(upgraded.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    expect(upgraded.prepare("SELECT * FROM quarantined_databases").all()).toEqual([
      {
        path: quarantinedPath,
        kind: "agent",
        reason: "retained quarantine",
        quarantined_at: 1,
        writer_app_version: "2026.9.5",
        verified_generation: null,
      },
    ]);
  } finally {
    upgraded.close();
  }
});

it("refuses the first write when its clean-close seal cannot be removed", () => {
  const env = { OMNIPOLYMATH_STATE_DIR: tempDirs.make("agent-integrity-dirty-failure-") };
  const options = { agentId: "policy", env };
  const agent = openOmnipolymathAgentDatabase(options);
  closeOmnipolymathAgentDatabaseByPath(agent.path);
  expect(readSqliteDatabaseCleanClose(agent.path)).toBe(true);
  const unlink = fs.unlinkSync;
  const failure = Object.assign(new Error("synthetic seal unlink failed"), { code: "EACCES" });
  const intercepted = vi.spyOn(fs, "unlinkSync").mockImplementation((pathname) => {
    if (String(pathname) === `${agent.path}.seal`) {
      throw failure;
    }
    return unlink(pathname);
  });
  try {
    expect(() => {
      const reopened = openOmnipolymathAgentDatabase(options);
      reopened.db.exec("INSERT INTO auth_profile_state VALUES ('must-not-write', '{}', 1)");
    }).toThrow(failure);
  } finally {
    intercepted.mockRestore();
  }
  const reopened = openOmnipolymathAgentDatabase(options);
  expect(
    reopened.db
      .prepare("SELECT state_key FROM auth_profile_state WHERE state_key='must-not-write'")
      .get(),
  ).toBeUndefined();
  reopened.db.exec("INSERT INTO auth_profile_state VALUES ('can-write', '{}', 1)");
  expect(readSqliteDatabaseCleanClose(agent.path)).toBe(false);
});
