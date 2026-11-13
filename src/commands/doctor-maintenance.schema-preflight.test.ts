import "../flows/doctor-health.test-support.js";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runCommandWithRuntime } from "../cli/cli-utils.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { runDoctorHealthFlow } from "../flows/doctor-health.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { corruptSqliteIndexKey } from "../infra/sqlite-index-corruption.test-support.js";
import { extractSqliteTableSchema } from "../infra/sqlite-schema-sql.js";
import { createLegacyDatabaseFixture } from "../infra/state-migrations.media-persistence.test-support.js";
import { readAgentDeletionRecoveryHolds } from "../state/agent-deletion-journal-recovery.kernel.js";
import { OMNIPOLYMATH_AGENT_SCHEMA_VERSION } from "../state/omnipolymath-agent-db-contract.js";
import { unregisterOmnipolymathAgentDatabase } from "../state/omnipolymath-agent-db-registry.js";
import { seedOmnipolymathDatabaseQuarantine } from "../state/omnipolymath-quarantine-store.test-support.js";
import {
  closeOmnipolymathStateDatabaseForTest,
  openOmnipolymathStateDatabase,
} from "../state/omnipolymath-state-db.js";
import { claimOmnipolymathStateOwnership } from "../state/omnipolymath-state-ownership-operations.js";
import { STATE_SUPERVISION_KEY } from "../state/omnipolymath-state-ownership.js";
import { OMNIPOLYMATH_STATE_SCHEMA_SQL } from "../state/omnipolymath-state-schema.js";
import {
  withOmnipolymathTestState,
  type OmnipolymathTestState,
} from "../test-utils/omnipolymath-test-state.js";

const withState = (run: (state: OmnipolymathTestState) => Promise<void>) =>
  withOmnipolymathTestState({ scenario: "minimal" }, run);
const { mocks } = await import("../flows/doctor-health.test-support.js");
beforeEach(() => {
  mocks.config.mockReturnValue({});
  mocks.packageRoot.mockReturnValue(undefined);
  mocks.outro.mockClear();
  mocks.runContributions.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

const auditRows = "SELECT * FROM audit_events NOT INDEXED";
const integrity = "PRAGMA integrity_check";
const runtimeMock = () => ({ log: vi.fn(), error: vi.fn(), exit: vi.fn() });
const runRepair = (runtime: ReturnType<typeof runtimeMock>) =>
  runCommandWithRuntime(runtime, () =>
    runDoctorHealthFlow(runtime, { repair: true, nonInteractive: true }),
  );
const outputOf = (runtime: ReturnType<typeof runtimeMock>) =>
  [...runtime.log.mock.calls, ...runtime.error.mock.calls].flat().join("\n");

function readRows(pathname: string, sql: string, ...params: string[]) {
  const { DatabaseSync } = requireNodeSqlite();
  using db = new DatabaseSync(pathname, { readOnly: true });
  return db.prepare(sql).all(...params);
}

function writeDatabase(pathname: string, sql: string) {
  fs.mkdirSync(path.dirname(pathname), { recursive: true });
  const { DatabaseSync } = requireNodeSqlite();
  using database = new DatabaseSync(pathname);
  database.exec(sql);
}

it("fails repair for an old configured agentDir schema", async () => {
  await withState(async (state) => {
    const agentDir = state.statePath(".omnipolymath", "agents", "worker", "agent");
    const config: OmnipolymathConfig = {
      agents: { ownership: "explicit", entries: { worker: { agentDir } } },
    };
    await state.writeConfig(config);
    mocks.config.mockReturnValue(config);
    const databasePath = createLegacyDatabaseFixture({
      agentId: "worker",
      env: state.env,
      eventsBySession: {},
      path: path.join(agentDir, "omnipolymath-agent.sqlite"),
      schemaVersion: 19,
    });
    unregisterOmnipolymathAgentDatabase({ agentId: "worker", env: state.env, path: databasePath });
    mocks.runContributions.mockImplementation(async (ctx) => {
      ctx.runtime.log("Migration refused; configured database left unchanged.");
    });
    const runtime = runtimeMock();
    await runRepair(runtime);

    expect(mocks.runContributions).toHaveBeenCalledOnce();
    expect(runtime.exit).toHaveBeenCalledExactlyOnceWith(1);
    const errors = runtime.error.mock.calls.flat().join("\n");
    expect(errors).toContain(databasePath);
    expect(errors).toContain("uses schema version 19");
    expect(mocks.outro).not.toHaveBeenCalledWith("Doctor complete.");
    expect(readRows(databasePath, "PRAGMA user_version")).toEqual([{ user_version: 19 }]);
  });
});

it("refuses newer agent schemas before repairing the registry", async () => {
  await withState(async (state) => {
    const agentPath = state.path("custom", "sessions.sqlite");
    const databasePath = state.statePath("state", "omnipolymath.sqlite");
    await state.writeConfig({
      agents: { ownership: "explicit", entries: { main: {} } },
      session: { store: agentPath },
    });
    writeDatabase(
      databasePath,
      `
      PRAGMA user_version = 8;
      CREATE TABLE agent_databases (
        agent_id TEXT NOT NULL, path TEXT NOT NULL, schema_version INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL, size_bytes INTEGER, PRIMARY KEY (agent_id, path)
      );
      ${extractSqliteTableSchema(OMNIPOLYMATH_STATE_SCHEMA_SQL, "agent_deletion_journal")}
      ${extractSqliteTableSchema(OMNIPOLYMATH_STATE_SCHEMA_SQL, "migration_sources")}
    `,
    );
    writeDatabase(
      agentPath,
      `
      PRAGMA user_version = ${OMNIPOLYMATH_AGENT_SCHEMA_VERSION + 1};
      CREATE TABLE schema_meta (meta_key TEXT PRIMARY KEY, agent_id TEXT);
      INSERT INTO schema_meta VALUES ('primary', 'main');
    `,
    );
    const paths = [state.configPath, databasePath, agentPath];
    const before = paths.map((pathname) => fs.readFileSync(pathname));

    await expect(
      runDoctorHealthFlow(runtimeMock(), { repair: true, nonInteractive: true }),
    ).rejects.toThrow("newer than this build");
    expect(paths.map((pathname) => fs.readFileSync(pathname))).toEqual(before);
  });
});

it("preserves audit rows and missing deletion history through index repair", async () => {
  await withState(async (state) => {
    const heldPath = createLegacyDatabaseFixture({
      agentId: "retained",
      env: state.env,
      eventsBySession: {},
      schemaVersion: OMNIPOLYMATH_AGENT_SCHEMA_VERSION,
      path: state.path("external-agent", "omnipolymath-agent.sqlite"),
    });
    const heldBytes = fs.readFileSync(heldPath);
    const resultPath = state.path("doctor-result.json");
    vi.stubEnv("OMNIPOLYMATH_UPDATE_POST_INSTALL_DOCTOR_RESULT_PATH", resultPath);
    const initial = openOmnipolymathStateDatabase({ env: state.env });
    initial.db.exec("DROP TABLE agent_deletion_journal");
    initial.db.exec(`INSERT INTO audit_events
      (event_id, source_id, source_sequence, occurred_at, kind, action, status, actor_type, actor_id)
      VALUES ('index-original', 'fixture-source', 1, 1, 'message', 'received', 'ok', 'system', 'fixture')`);
    const rows = initial.db.prepare(auditRows).all();
    closeOmnipolymathStateDatabaseForTest();
    const index = "sqlite_autoindex_audit_events_1";
    corruptSqliteIndexKey(initial.path, index, "index-original", "index-damaged!");
    expect(readRows(initial.path, auditRows)).toEqual(rows);
    const findings = readRows(initial.path, integrity);
    expect(findings).toContainEqual({ integrity_check: `row 1 missing from index ${index}` });
    const quarantine = () =>
      seedOmnipolymathDatabaseQuarantine({
        env: state.env,
        kind: "state",
        path: initial.path,
        reason: `row 1 missing from index ${index}`,
      });
    quarantine();
    const runtime = runtimeMock();
    await runRepair(runtime);

    const output = outputOf(runtime);
    expect(runtime.exit, output).not.toHaveBeenCalled();
    expect(mocks.outro).toHaveBeenCalledWith("Doctor complete.");
    expect(mocks.writeUpdatePostInstallDoctorResult).toHaveBeenCalledWith({
      resultPath,
      result: expect.objectContaining({
        status: "ok",
        warnings: expect.arrayContaining([expect.stringContaining(heldPath)]),
      }),
    });
    expect(output).toContain(`Warning: Rebuilt corrupt shared-state SQLite indexes: ${index}`);
    const backupPrefix = "Saved pre-repair SQLite backup: ";
    const backupLine = runtime.log.mock.calls
      .flat()
      .find((line) => String(line).startsWith(backupPrefix));
    expect(backupLine).toBeTypeOf("string");
    const backupPath = String(backupLine).slice(backupPrefix.length);
    expect(readRows(backupPath, integrity)).toEqual(findings);
    expect(readRows(backupPath, auditRows)).toEqual(rows);
    const repaired = openOmnipolymathStateDatabase({ env: state.env });
    expect(repaired.db.prepare(integrity).all()).toEqual([{ integrity_check: "ok" }]);
    const expectRetained = () => {
      const current = openOmnipolymathStateDatabase({ env: state.env });
      expect(current.db.prepare(auditRows).all()).toEqual(rows);
      expect(readAgentDeletionRecoveryHolds(current)).toEqual([
        { agentId: "retained", path: heldPath },
      ]);
      expect(fs.readFileSync(heldPath)).toEqual(heldBytes);
    };
    expectRetained();
    expect(output).toContain("recorded a Doctor receipt");

    // Model a committed REINDEX whose quarantine finalization was interrupted.
    closeOmnipolymathStateDatabaseForTest();
    quarantine();
    runtime.exit.mockClear();
    runtime.error.mockClear();
    await runRepair(runtime);
    expect(runtime.exit, runtime.error.mock.calls.flat().join("\n")).not.toHaveBeenCalled();
    expectRetained();
  });
});

it("Doctor refuses to rebuild an index that hides the external state owner", async () => {
  await withOmnipolymathTestState(
    { scenario: "minimal", env: { OMNIPOLYMATH_SUPERVISOR_MODE: undefined } },
    async (state) => {
      const externalEnv = { ...state.env, OMNIPOLYMATH_SUPERVISOR_MODE: "external" };
      const ownership = claimOmnipolymathStateOwnership("fixture-supervisor", { env: externalEnv });
      const databasePath = openOmnipolymathStateDatabase({ env: externalEnv }).path;
      closeOmnipolymathStateDatabaseForTest();
      const index = "sqlite_autoindex_config_machine_state_1";
      corruptSqliteIndexKey(databasePath, index, STATE_SUPERVISION_KEY, "gateway.supervisioX");
      const before = fs.readFileSync(databasePath);
      const readOwner = (scan: string) =>
        readRows(
          databasePath,
          `SELECT value_json FROM config_machine_state ${scan} WHERE state_key = ?`,
          STATE_SUPERVISION_KEY,
        );
      expect(readOwner("")).toEqual([]);
      expect(readOwner("NOT INDEXED")).toEqual([{ value_json: JSON.stringify(ownership) }]);
      const findings = readRows(databasePath, integrity);
      expect(findings).toContainEqual({
        integrity_check: expect.stringContaining(`missing from index ${index}`),
      });
      const runtime = runtimeMock();
      await runRepair(runtime);

      expect(runtime.exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(runtime.error.mock.calls.flat().join("\n")).toContain(
        "externally supervised by fixture-supervisor",
      );
      expect(
        fs.readFileSync(databasePath).equals(before),
        "Doctor must refuse before changing the owner index",
      ).toBe(true);
      expect(
        fs
          .readdirSync(path.dirname(databasePath))
          .filter((name) => name.startsWith("omnipolymath-index-recovery-")),
      ).toEqual([]);
      expect(readRows(databasePath, integrity)).toEqual(findings);
    },
  );
});
