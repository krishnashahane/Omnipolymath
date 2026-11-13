import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  original,
  preparation,
  stateV22Schema,
} from "./omnipolymath-historical-imports.test-support.js";
import { OMNIPOLYMATH_STATE_SCHEMA_VERSION } from "./omnipolymath-state-db-contract.js";
import { ensureSecretStoreSchema } from "./omnipolymath-state-db-schema-additive.js";
import { closeOmnipolymathStateDatabaseAsync, openOmnipolymathStateDatabase } from "./omnipolymath-state-db.js";
import { withStateMigrationBackupForTest } from "./omnipolymath-state-schema.test-support.js";

const dirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(closeOmnipolymathStateDatabaseAsync);

it("ordinary open with a lazy-column gap rolls back malformed images, then imports without losing custody", async () => {
  const env = { OMNIPOLYMATH_STATE_DIR: dirs.make("historical-image-fallback-") };
  const pathname = path.join(env.OMNIPOLYMATH_STATE_DIR, "state", "omnipolymath.sqlite");
  fs.mkdirSync(path.dirname(pathname), { recursive: true });
  const options = { env, path: pathname };
  using db = new DatabaseSync(pathname);
  db.exec(stateV22Schema());
  db.exec(
    "PRAGMA user_version=22; INSERT INTO schema_meta(meta_key,role,schema_version,created_at,updated_at) VALUES ('primary','global',22,1,1);",
  );
  ensureSecretStoreSchema(db);
  db.exec("ALTER TABLE secret_store_entries DROP COLUMN allowed_hosts");
  for (const [id, profile] of [
    ["valid", original],
    [
      "invalid",
      JSON.stringify({ project: { kind: "image", key: "b".repeat(64), preparation: {} } }),
    ],
  ] as const) {
    db.prepare(
      "INSERT INTO worker_environments " +
        "(environment_id,provider_id,profile_id,profile_snapshot_json,provision_operation_id,lease_id," +
        "preparation_key,preparation_purpose,preparation_demand_at_ms,preparation_expires_at_ms," +
        "preparation_consumed_at_ms,state,owner_epoch,attached_session_ids_json," +
        "created_at_ms,updated_at_ms,state_changed_at_ms,destroy_requested_at_ms) " +
        "VALUES (?, 'synthetic','profile',?,?,?,?,'reserve',1000,2000,1500,'destroyed',7,'[]',1,2,2,2)",
    ).run(id, profile, id, "lease-" + id, preparation.key);
  }
  const rows = db.prepare("SELECT * FROM worker_environments ORDER BY environment_id").all();
  await withStateMigrationBackupForTest(options, async () => {
    expect(() => openOmnipolymathStateDatabase(options)).toThrow(
      "Worker runtime preparation identity is invalid",
    );
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(22);
    expect(db.prepare("SELECT schema_version FROM schema_meta").get()?.schema_version).toBe(22);
    expect(db.prepare("SELECT * FROM worker_environments ORDER BY environment_id").all()).toEqual(
      rows,
    );
    db.prepare(
      "UPDATE worker_environments SET profile_snapshot_json=? WHERE environment_id='invalid'",
    ).run(original);
    openOmnipolymathStateDatabase(options);
    await closeOmnipolymathStateDatabaseAsync();
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(
      OMNIPOLYMATH_STATE_SCHEMA_VERSION,
    );
    expect(db.prepare("SELECT schema_version FROM schema_meta").get()?.schema_version).toBe(
      OMNIPOLYMATH_STATE_SCHEMA_VERSION,
    );
    const after = db.prepare("SELECT * FROM worker_environments ORDER BY environment_id").all();
    expect(after).toHaveLength(rows.length);
    for (const [index, row] of after.entries()) {
      expect(row).toEqual({
        ...rows[index],
        profile_snapshot_json: expect.any(String),
        resource_receipt_json: null,
        retention_json: null,
      });
      expect(JSON.parse(String(row.profile_snapshot_json))).toEqual({
        install: "bundle",
        settings: { provider: "synthetic" },
        runtimePreparation: { ...preparation, source: "empty" },
        historicalProfileSnapshotJson: original,
      });
    }
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
