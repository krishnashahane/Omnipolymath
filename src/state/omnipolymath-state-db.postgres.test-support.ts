import assert from "node:assert/strict";
import { channel } from "node:diagnostics_channel";
import { parentPort, threadId, workerData } from "node:worker_threads";
import { prepareDoctorDatabaseMigrations } from "../commands/doctor-schema-migrations.js";
import { getPostgresPhysicalFacts } from "../infra/database-engine/physical-facts.js";
import { createSqlStatementObserver } from "../infra/database-engine/sql-statement-observer.test-support.js";
import { acquireGatewayLock } from "../infra/gateway-lock.js";
import { isPostgresSqlConnection } from "../infra/sql-connection.js";
import {
  installSqliteDatabaseAdmissions,
  type SqliteDatabaseAdmissions,
} from "../infra/sqlite-database-admission.js";
import { omnipolymathStateDatabaseCache } from "./omnipolymath-state-db-cache.js";
import { OMNIPOLYMATH_STATE_SCHEMA_VERSION } from "./omnipolymath-state-db-contract.js";
import {
  openOmnipolymathStateReadConnection,
  withOmnipolymathStateReadOnlyLocation,
  assertStateReadSchema,
} from "./omnipolymath-state-db-read-connection.js";
import { ensureSecretStoreSchema } from "./omnipolymath-state-db-schema-additive.js";
import { tableExists } from "./omnipolymath-state-db-schema-helpers.js";
import { withExistingOmnipolymathStateSchema } from "./omnipolymath-state-db-schema-policy.js";
import {
  openOmnipolymathStateDatabase,
  closeOmnipolymathStateDatabase,
  runOmnipolymathStateWriteTransaction,
} from "./omnipolymath-state-db.js";
import { ensureUserBackgroundSchema } from "./user-background.store.js";

const input: {
  path: string;
  env: NodeJS.ProcessEnv;
  mode: "bootstrap" | "restart" | "migrate";
  admissions: SqliteDatabaseAdmissions;
} = workerData;
if (parentPort) {
  const port = parentPort;
  let catalogReads = 0;
  const observer = createSqlStatementObserver(
    (sql) => sql.startsWith("WITH captured"),
    () => {
      catalogReads++;
    },
  );
  channel("omnipolymath.database.statement").subscribe(observer);
  try {
    installSqliteDatabaseAdmissions(input.admissions);
    const options = { path: input.path, env: input.env };
    const writeConformance = (value: string, insert = false) =>
      runOmnipolymathStateWriteTransaction(
        ({ db }) =>
          db
            .prepare(
              insert
                ? "INSERT INTO config_machine_state (state_key, value_json, updated_at_ms) VALUES ('conformance', ?, 1)"
                : "UPDATE config_machine_state SET value_json = ? WHERE state_key = 'conformance'",
            )
            .run(value),
        options,
      );
    if (input.mode === "migrate") {
      const lock = await acquireGatewayLock({
        env: input.env,
        allowInTests: true,
        role: "sqlite-maintenance",
        timeoutMs: 0,
      });
      assert(lock);
      try {
        const migration = await lock.run(() =>
          prepareDoctorDatabaseMigrations({
            env: input.env,
            databasePaths: [input.path],
            pendingDatabasePaths: [input.path],
            pendingMigrations: [
              {
                kind: "state",
                path: input.path,
                foundVersion: 24,
                supportedVersion: OMNIPOLYMATH_STATE_SCHEMA_VERSION,
              },
            ],
          }),
        );
        assert.deepEqual(migration.warnings, []);
      } finally {
        await lock.release();
      }
    }
    let database = openOmnipolymathStateDatabase(options);
    assert(isPostgresSqlConnection(database.db));
    const initial = getPostgresPhysicalFacts(database.db);
    assert(initial);
    assert.equal(initial.version, OMNIPOLYMATH_STATE_SCHEMA_VERSION);
    assert.equal(
      database.db.prepare("SELECT schema_version FROM schema_meta WHERE meta_key = 'primary'").get()
        ?.schema_version,
      OMNIPOLYMATH_STATE_SCHEMA_VERSION,
    );
    assert.equal(
      database.db
        .prepare(
          "SELECT value_json FROM config_machine_state WHERE state_key = 'state.schema.contentVersion'",
        )
        .get()?.value_json,
      String(OMNIPOLYMATH_STATE_SCHEMA_VERSION),
    );
    if (input.mode === "bootstrap") {
      assert.equal(tableExists(database.db, "user_background_images"), false);
      assert.throws(
        () =>
          runOmnipolymathStateWriteTransaction(() => {
            ensureUserBackgroundSchema(options);
            assert.equal(tableExists(database.db, "user_background_images"), true);
            throw new Error("rollback lazy schema");
          }, options),
        /rollback lazy schema/,
      );
      assert.equal(tableExists(database.db, "user_background_images"), false);
      ensureUserBackgroundSchema(options);
      assert.equal(tableExists(database.db, "user_background_images"), true);
      assert.equal(tableExists(database.db, "user_profiles"), true);
      writeConformance("before", true);
      const snapshot = withOmnipolymathStateReadOnlyLocation(
        ({ db }) => {
          assert.equal(db.prepare("SHOW transaction_read_only").get()?.transaction_read_only, "on");
          assert.equal(
            db.prepare("SHOW transaction_isolation").get()?.transaction_isolation,
            "repeatable read",
          );
          const before = db
            .prepare("SELECT value_json FROM config_machine_state WHERE state_key = ?")
            .get("conformance")?.value_json;
          runOmnipolymathStateWriteTransaction(
            ({ db: writer }) =>
              writer
                .prepare("UPDATE config_machine_state SET value_json = ? WHERE state_key = ?")
                .run("after", "conformance"),
            options,
          );
          return [
            before,
            db
              .prepare("SELECT value_json FROM config_machine_state WHERE state_key = ?")
              .get("conformance")?.value_json,
          ];
        },
        input.path,
        input.path,
      );
      assert.deepEqual(snapshot, ["before", "before"]);
      const reader = openOmnipolymathStateReadConnection(input.path, input.path);
      assert(isPostgresSqlConnection(reader.database.db));
      assert.throws(
        () => assertStateReadSchema(reader.database.db, input.path, "verify"),
        /PostgreSQL.*SQLite/,
      );
      const readerAnchor = reader.database.db.anchor;
      const close = reader.database.db.close.bind(reader.database.db);
      reader.database.db.close = () => {
        throw new Error("injected close failure");
      };
      assert.throws(() => reader.close(), /injected close failure/);
      assert.equal(readerAnchor.isOpen, true);
      reader.database.db.close = close;
      assert.equal(reader.close(), true);
      assert.equal(readerAnchor.isOpen, false);
      const retainedId = getPostgresPhysicalFacts(database.db)?.admissionId;
      closeOmnipolymathStateDatabase();
      assert.equal(database.db.isOpen, false);
      assert.equal(database.db.anchor.isOpen, false);
      const reads = catalogReads;
      database = openOmnipolymathStateDatabase(options);
      assert.equal(getPostgresPhysicalFacts(database.db)?.admissionId, retainedId);
      assert.equal(catalogReads, reads);
      closeOmnipolymathStateDatabase();
      withExistingOmnipolymathStateSchema(options, () => {
        const existing = openOmnipolymathStateDatabase(options);
        assert.equal(
          existing.db
            .prepare("SELECT value_json FROM config_machine_state WHERE state_key = ?")
            .get("conformance")?.value_json,
          "after",
        );
        closeOmnipolymathStateDatabase();
      });
    } else {
      assert.equal(tableExists(database.db, "user_background_images"), true);
      assert.equal(tableExists(database.db, "secret_store_entries"), true);
      runOmnipolymathStateWriteTransaction(({ db }) => ensureSecretStoreSchema(db), options);
      assert.equal(tableExists(database.db, "secret_store_entries"), true);
      assert.equal(
        database.db
          .prepare("SELECT value_json FROM config_machine_state WHERE state_key = ?")
          .get("conformance")?.value_json,
        "after",
      );
      if (input.mode === "restart") {
        assert.equal(catalogReads, 1);
      }
      closeOmnipolymathStateDatabase();
    }
    port.postMessage({
      namespace: initial.namespace,
      admissionId: initial.admissionId,
      catalogReads,
      threadId,
    });
  } catch (error) {
    port.postMessage({ error: error instanceof Error ? error.stack : String(error) });
  } finally {
    try {
      omnipolymathStateDatabaseCache.closeOmnipolymathStateDatabaseForTest();
    } finally {
      port.close();
    }
  }
}
