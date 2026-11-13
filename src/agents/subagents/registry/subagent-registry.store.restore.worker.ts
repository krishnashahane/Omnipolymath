import { getNodeSqliteKysely, iterateSqliteQuerySync } from "../../../infra/kysely-sync.js";
import { isPostgresSqlConnection } from "../../../infra/sql-connection.js";
import { isSqliteCorruptionError } from "../../../infra/sqlite-error-diagnostics.js";
import { throwSqliteLifecycleErrors } from "../../../infra/sqlite-lifecycle-errors.js";
import { admitSqliteSchema } from "../../../infra/sqlite-schema-facts.js";
import type { WorkerTaskChannel } from "../../../infra/worker-task-server.js";
import { invalidateOmnipolymathStateRuntimeIntegrity } from "../../../state/omnipolymath-state-db-integrity-admission.js";
import {
  assertStateReadSchema,
  openOmnipolymathStateReadConnection,
} from "../../../state/omnipolymath-state-db-read-connection.js";
import type { DB as OmnipolymathStateKyselyDatabase } from "../../../state/omnipolymath-state-db.generated.js";
import type { OmnipolymathStateReadRequest } from "../../../state/omnipolymath-state-read.types.js";
import { rowToSubagentRunRecord } from "./subagent-registry.store.codec.js";

/** The single SELECT owns its snapshot; backpressure bounds decoded facts in flight. */
export async function streamSubagentRegistryInWorker(
  input: OmnipolymathStateReadRequest,
  channel: WorkerTaskChannel,
  onAdmitted: () => void,
): Promise<number> {
  const connection = openOmnipolymathStateReadConnection(
    input.databasePath,
    input.location,
    input.expectedIdentity,
    input.snapshotRoot,
  );
  const { db } = connection.database;
  const errors: unknown[] = [];
  let count = 0;
  try {
    assertStateReadSchema(db, input.databasePath);
    if (!isPostgresSqlConnection(db)) {
      admitSqliteSchema(db);
    }
    onAdmitted();
    const query = getNodeSqliteKysely<Pick<OmnipolymathStateKyselyDatabase, "subagent_runs">>(db)
      .selectFrom("subagent_runs")
      .selectAll()
      .orderBy("run_id", "asc");
    let batch = [];
    let bytes = 0;
    for (const row of iterateSqliteQuerySync(db, query)) {
      const size = Buffer.byteLength(row.payload_json);
      if (batch.length && (batch.length === 128 || bytes + size > 1024 * 1024)) {
        (await channel.request(batch)).consumed();
        batch = [];
        bytes = 0;
      }
      const entry = rowToSubagentRunRecord(row);
      if (!entry) {
        throw new Error("Canonical subagent restore found an unreadable durable row");
      }
      batch.push({ entry, createdAt: row.created_at });
      bytes += size;
      count += 1;
    }
    if (batch.length) {
      (await channel.request(batch)).consumed();
    }
  } catch (error) {
    if (!isPostgresSqlConnection(db) && isSqliteCorruptionError(error)) {
      invalidateOmnipolymathStateRuntimeIntegrity(db);
    }
    errors.push(error);
  }
  try {
    connection.close();
  } catch (error) {
    errors.push(error);
  }
  throwSqliteLifecycleErrors(errors, "Subagent restore and reader cleanup failed");
  return count;
}
