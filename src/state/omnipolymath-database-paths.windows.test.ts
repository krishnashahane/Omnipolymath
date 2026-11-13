import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { noteDoctorAgentDatabasePathHealth } from "../commands/doctor-agent-database-paths.js";
import { compactDoctorSessionSqliteTarget } from "../commands/doctor-session-sqlite-compact.js";
import { runDoctorStateSqliteCompact } from "../commands/doctor-state-sqlite-compact.js";
import type { EngineConnection } from "../infra/sql-connection.js";
import { readUpdateStateSchemaVersions } from "../infra/update-candidate-state.js";
import { updateStateSchemaVersionsMatch } from "../infra/update-candidate-state.versions.js";
import { createUpdateRun, finishUpdateRun } from "../infra/update-run-ledger.js";
import { requireNativeSqliteDatabase } from "../test-utils/native-sqlite.js";
import { withOmnipolymathAgentDatabaseReadOnly } from "./omnipolymath-agent-db-readonly.js";
import {
  closeOmnipolymathAgentDatabasesForTest,
  OMNIPOLYMATH_AGENT_SCHEMA_VERSION,
  openOmnipolymathAgentDatabase,
} from "./omnipolymath-agent-db.js";
import { resolveOmnipolymathAgentSqlitePath } from "./omnipolymath-agent-db.paths.js";
import { preflightOmnipolymathDatabaseSchemas } from "./omnipolymath-database-preflight.js";
import { OMNIPOLYMATH_STATE_SCHEMA_VERSION } from "./omnipolymath-state-db-contract.js";
import { withOmnipolymathStateDatabaseReadOnly } from "./omnipolymath-state-db-readonly.js";
import {
  closeOmnipolymathStateDatabaseForTest,
  openExistingOmnipolymathStateDatabaseReadOnly,
  openOmnipolymathStateDatabase,
  repairOmnipolymathStateDatabaseSchema,
} from "./omnipolymath-state-db.js";
import { resolveOmnipolymathStateSqlitePath } from "./omnipolymath-state-db.paths.js";
import {
  addPreCutoverClientCredentialTablesForTest,
  restorePreTemplateStateIdentifiersForTest,
  withStateMigrationBackupForTest,
} from "./omnipolymath-state-schema.test-support.js";

const MAX_PATH = 260;
const AGENT_ID = "windows-long-path";
const tempDirs = useAutoCleanupTempDirTracker((cleanup) => {
  afterEach(() => {
    closeOmnipolymathAgentDatabasesForTest();
    closeOmnipolymathStateDatabaseForTest();
    cleanup();
  });
});

function createDeepStateEnv(): NodeJS.ProcessEnv {
  const env = {
    ...process.env,
    OMNIPOLYMATH_STATE_DIR: tempDirs.make("omnipolymath-database-paths-windows-"),
  };
  while (
    resolveOmnipolymathStateSqlitePath(env).length <= MAX_PATH ||
    resolveOmnipolymathAgentSqlitePath({ agentId: AGENT_ID, env }).length <= MAX_PATH
  ) {
    env.OMNIPOLYMATH_STATE_DIR = path.join(env.OMNIPOLYMATH_STATE_DIR, `segment-${"x".repeat(24)}`);
  }
  fs.mkdirSync(env.OMNIPOLYMATH_STATE_DIR, { recursive: true });
  return env;
}

function versionedPath({ db, path: pathname }: { db: EngineConnection; path: string }) {
  return [pathname, db.prepare("PRAGMA user_version").get()];
}

function entries(databasePath: string) {
  return fs.readdirSync(path.dirname(databasePath)).toSorted();
}

describe.runIf(process.platform === "win32")("Omnipolymath database paths on Windows", () => {
  it("migrates legacy namespace collisions through captured startup and Doctor", async () => {
    for (const repair of [false, true]) {
      const env = { OMNIPOLYMATH_STATE_DIR: tempDirs.make("omnipolymath-native-legacy-alias-") };
      const database = openOmnipolymathStateDatabase({ env });
      const agentPath = resolveOmnipolymathAgentSqlitePath({ agentId: "main", env });
      const insert = database.db.prepare("INSERT INTO agent_databases VALUES ('main', ?, ?, ?, ?)");
      insert.run(agentPath, 18, 100, 10);
      insert.run(path.toNamespacedPath(agentPath), 20, 200, 20);
      restorePreTemplateStateIdentifiersForTest(database.db);
      addPreCutoverClientCredentialTablesForTest(database.db);
      database.db.exec(
        "PRAGMA user_version=8; UPDATE schema_meta SET schema_version=8 WHERE meta_key='primary'",
      );
      closeOmnipolymathStateDatabaseForTest();
      await withStateMigrationBackupForTest({ env }, () => {
        if (repair) {
          expect(repairOmnipolymathStateDatabaseSchema({ env }).warnings).toEqual([]);
        } else {
          openOmnipolymathStateDatabase({ env });
        }
      });
      const migrated = openOmnipolymathStateDatabase({ env });
      expect(migrated.db.prepare("SELECT * FROM agent_databases").all()).toEqual([
        {
          agent_id: "main",
          path: path.join("agents", "main", "agent", "omnipolymath-agent.sqlite"),
          schema_version: 20,
          last_seen_at: 200,
          size_bytes: 20,
        },
      ]);
      closeOmnipolymathStateDatabaseForTest();
    }
  });

  it("repairs aliases before a native update baseline and preserves active update inventories", async () => {
    const env = { OMNIPOLYMATH_STATE_DIR: tempDirs.make("omnipolymath-native-doctor-alias-") };
    const agent = openOmnipolymathAgentDatabase({ agentId: "main", env });
    const state = openOmnipolymathStateDatabase({ env });
    const addAlias = () =>
      state.db
        .prepare("INSERT INTO agent_databases VALUES ('main', ?, ?, ?, ?)")
        .run(path.toNamespacedPath(agent.path), OMNIPOLYMATH_AGENT_SCHEMA_VERSION, Date.now(), 123);
    const inspect = () =>
      readUpdateStateSchemaVersions({ stateDir: env.OMNIPOLYMATH_STATE_DIR, config: {}, env });
    const expectInventory = async (baseline: Awaited<ReturnType<typeof inspect>>) => {
      expect(
        updateStateSchemaVersionsMatch(baseline, await inspect(), { sharedPath: state.path }),
      ).toBe(true);
    };
    addAlias();
    expect(noteDoctorAgentDatabasePathHealth({ env, shouldRepair: true })).toEqual([]);
    expect(state.db.prepare("SELECT COUNT(*) AS count FROM agent_databases").get()).toEqual({
      count: 1,
    });
    const baseline = await inspect();
    await expectInventory(baseline);

    addAlias();
    const mixedBaseline = await inspect();
    const run = createUpdateRun({ trigger: "cli" }, { env });
    expect(noteDoctorAgentDatabasePathHealth({ env, shouldRepair: true })).toEqual([
      expect.stringContaining(`update ${run.runId} is in progress`),
    ]);
    await expectInventory(mixedBaseline);
    finishUpdateRun(run.runId, { status: "succeeded" }, { env });
    expect(
      noteDoctorAgentDatabasePathHealth({
        env: { ...env, OMNIPOLYMATH_UPDATE_PARENT_SUPPORTS_DOCTOR_CONFIG_WRITE: "1" },
        shouldRepair: true,
      }),
    ).toEqual([expect.stringContaining("during update Doctor")]);
    await expectInventory(mixedBaseline);
  });

  it("registers a reopened native filename as the same relative inventory row", () => {
    const env = { OMNIPOLYMATH_STATE_DIR: tempDirs.make("omnipolymath-native-registration-") };
    const options = { agentId: "main", env };
    const first = openOmnipolymathAgentDatabase(options);
    const nativeFilename = requireNativeSqliteDatabase(first.db).location();
    expect(nativeFilename).toBe(path.toNamespacedPath(first.path));
    if (nativeFilename === null) {
      throw new Error("Expected a file-backed database");
    }
    closeOmnipolymathAgentDatabasesForTest();
    openOmnipolymathAgentDatabase({ ...options, path: nativeFilename });
    const state = openOmnipolymathStateDatabase({ env });
    expect(state.db.prepare("SELECT agent_id, path FROM agent_databases").all()).toEqual([
      { agent_id: "main", path: path.join("agents", "main", "agent", "omnipolymath-agent.sqlite") },
    ]);

    const external = path.join(tempDirs.make("omnipolymath-native-external-"), "agent.sqlite");
    const externalNative = path.toNamespacedPath(external);
    openOmnipolymathAgentDatabase({ agentId: "external", env, path: externalNative });
    expect(
      state.db.prepare("SELECT path FROM agent_databases WHERE agent_id = 'external'").get(),
    ).toEqual({ path: externalNative });
  });

  it("opens, preflights, compacts, and reopens canonical databases beyond MAX_PATH", async () => {
    const env = createDeepStateEnv();
    const statePath = resolveOmnipolymathStateSqlitePath(env);
    const agentPath = resolveOmnipolymathAgentSqlitePath({ agentId: AGENT_ID, env });
    expect(statePath.startsWith("\\\\?\\")).toBe(false);
    expect(agentPath.startsWith("\\\\?\\")).toBe(false);
    expect(statePath.length).toBeGreaterThan(MAX_PATH);
    expect(agentPath.length).toBeGreaterThan(MAX_PATH);

    const state = openOmnipolymathStateDatabase({ env });
    const agent = openOmnipolymathAgentDatabase({ agentId: AGENT_ID, env });
    expect(state.path).toBe(statePath);
    expect(agent.path).toBe(agentPath);
    closeOmnipolymathAgentDatabasesForTest();
    closeOmnipolymathStateDatabaseForTest();

    expect(withOmnipolymathStateDatabaseReadOnly(versionedPath, { env })).toEqual([
      statePath,
      { user_version: OMNIPOLYMATH_STATE_SCHEMA_VERSION },
    ]);
    expect(withOmnipolymathAgentDatabaseReadOnly(versionedPath, { agentId: AGENT_ID, env })).toEqual({
      found: true,
      value: [agentPath, { user_version: OMNIPOLYMATH_AGENT_SCHEMA_VERSION }],
    });
    expect(
      await preflightOmnipolymathDatabaseSchemas({
        env,
        supportedVersions: {
          state: OMNIPOLYMATH_STATE_SCHEMA_VERSION,
          agent: OMNIPOLYMATH_AGENT_SCHEMA_VERSION,
        },
      }),
    ).toEqual({ incompatible: [], indeterminate: [] });
    fs.rmSync(`${statePath}-wal`, { force: true });
    fs.rmSync(`${statePath}-shm`, { force: true });
    const stateBytesBeforeReadOnly = fs.readFileSync(statePath);
    const stateEntriesBeforeReadOnly = entries(statePath);
    const readOnlyState = await openExistingOmnipolymathStateDatabaseReadOnly({ env });
    expect(readOnlyState?.path).toBe(statePath);
    const openedStatePath = readOnlyState?.db.prepare("PRAGMA database_list").get() as
      | { file?: unknown }
      | undefined;
    expect(path.resolve(String(openedStatePath?.file))).not.toBe(path.resolve(statePath));
    const privateDirectory = path.dirname(String(openedStatePath?.file));
    expect(readOnlyState?.walMaintenance.close()).toBe(true);
    expect(fs.existsSync(privateDirectory)).toBe(false);
    assert.deepStrictEqual(fs.readFileSync(statePath), stateBytesBeforeReadOnly);
    expect(entries(statePath)).toEqual(stateEntriesBeforeReadOnly);

    await expect(runDoctorStateSqliteCompact({ env })).resolves.toMatchObject({
      integrityCheck: "ok",
      path: statePath,
      skipped: false,
    });
    expect(
      await compactDoctorSessionSqliteTarget(
        {
          agentId: AGENT_ID,
          storePath: path.join(
            env.OMNIPOLYMATH_STATE_DIR ?? "",
            "agents",
            AGENT_ID,
            "sessions",
            "sessions.json",
          ),
        },
        { env },
      ),
    ).toMatchObject({
      freelistAfterPages: 0,
      skipped: false,
      walSizeAfterBytes: 0,
    });

    expect(openOmnipolymathStateDatabase({ env }).path).toBe(statePath);
    expect(openOmnipolymathAgentDatabase({ agentId: AGENT_ID, env }).path).toBe(agentPath);
  });
});
