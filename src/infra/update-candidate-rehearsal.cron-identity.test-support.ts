import { DatabaseSync } from "node:sqlite";
import { readCronDefaultStoreKeyInDatabase } from "../state/omnipolymath-state-db-cron-identity-migration.js";
import {
  closeOmnipolymathStateDatabaseForTest,
  openOmnipolymathStateDatabase,
} from "../state/omnipolymath-state-db.js";
import { withStateMigrationBackupForTest } from "../state/omnipolymath-state-schema.test-support.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";

async function seedLegacyDatabase() {
  const input = JSON.parse(process.argv[3] ?? "null") as {
    stateDir?: unknown;
    storeKeys?: unknown;
  } | null;
  if (
    typeof input?.stateDir !== "string" ||
    !Array.isArray(input.storeKeys) ||
    !input.storeKeys.every((entry): entry is string => typeof entry === "string")
  ) {
    throw new Error("Invalid cron identity seed input");
  }
  const state = openOmnipolymathStateDatabase({ env: { OMNIPOLYMATH_STATE_DIR: input.stateDir } });
  const databasePath = state.path;
  closeOmnipolymathStateDatabaseForTest();
  using database = new DatabaseSync(databasePath);
  database.exec(`DELETE FROM config_machine_state WHERE state_key IN
      ('cron.defaultStoreKey', 'state.schema.contentVersion');
    UPDATE schema_meta SET schema_version = 33;
    PRAGMA user_version = 33;`);
  const insert = database.prepare(`INSERT INTO cron_jobs
    (store_key, job_id, name, enabled, payload_kind, job_json, state_json, updated_at)
    VALUES (?, ?, 'Migration job', 0, 'agentTurn', '{}', '{}', 1)`);
  input.storeKeys.forEach((storeKey, index) => insert.run(storeKey, `job-${index}`));
  process.stdout.write(`CRON_IDENTITY_SEED ${JSON.stringify({ databasePath })}\n`);
}

async function runFirstPrivateAdmission() {
  const environment = process.env;
  const initializationCronDefaultStoreKey = captureOmnipolymathStateWorkerContext({
    env: environment,
  }).initializationCronDefaultStoreKey;
  try {
    const boundStoreKey = await withStateMigrationBackupForTest({ env: environment }, () => {
      const state = openOmnipolymathStateDatabase({ env: environment });
      return readCronDefaultStoreKeyInDatabase(state.db);
    });
    process.stdout.write(
      `CRON_IDENTITY_RESULT ${JSON.stringify({
        initializationCronDefaultStoreKey,
        boundStoreKey,
      })}\n`,
    );
  } finally {
    closeOmnipolymathStateDatabaseForTest();
  }
}

await (process.argv[2] === "seed" ? seedLegacyDatabase() : runFirstPrivateAdmission());
