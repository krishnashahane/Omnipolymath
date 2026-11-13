// Narrow SQLite schema, path, and transaction helpers for first-party runtime.

export type { Generated, Selectable } from "kysely";
export { runQueuedStoreWrite, type StoreWriterQueue } from "../shared/store-writer-queue.js";
export { hasSqliteWorkerOutcomeUnknown } from "../infra/sqlite-worker-contract.js";
export { isSqliteSnapshotCapacityError } from "../infra/sqlite-snapshot-capacity-error.js";
export {
  openSqliteWorkerStore,
  runSqliteWorkerStoreOperation,
  runSqliteWorkerStoreWrite,
  SqliteWorkerError,
  type SqliteWorkerBackend,
  type SqliteWorkerCommand,
  type SqliteWorkerOperations,
  type SqliteWorkerStore,
} from "../infra/sqlite-worker-store.js";
export { requestSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
export {
  readSqliteDatabaseScopedWriteTokenForPath,
  readSqliteDatabaseWriteTokenForPath,
  retireSqliteDatabaseAdmissionForPath,
} from "../infra/sqlite-database-admission.js";
export {
  openOmnipolymathAgentSqliteWorkerStore,
  openOmnipolymathAgentSqliteWorkerStoreV2,
  type OmnipolymathAgentSqliteWorkerStore,
  type OmnipolymathAgentSqliteWorkerAuthorityV2,
  type OmnipolymathAgentSqliteWorkerStoreV2,
} from "../state/omnipolymath-agent-worker-store.js";

export {
  ensureOmnipolymathAgentDatabaseSchema,
  resolveOmnipolymathAgentSqlitePath,
} from "../state/omnipolymath-agent-db.js";
export { withOmnipolymathAgentDatabaseReadOnly } from "../state/omnipolymath-agent-db-readonly.js";
export { withFreshOmnipolymathAgentDatabaseReadOnly } from "../state/omnipolymath-agent-db-readonly-open.js";
export { readOmnipolymathAgentDatabaseIdentity } from "../state/omnipolymath-agent-db-identity.js";
export {
  captureOmnipolymathAgentDatabaseExecution,
  supportsOmnipolymathAgentDatabaseExecution,
} from "../state/omnipolymath-agent-execution.js";
export type { OmnipolymathAgentDatabaseExecution } from "../state/omnipolymath-agent-execution-contract.js";
export { assertOmnipolymathAgentDatabaseForMaintenance } from "../state/omnipolymath-agent-db-maintenance.js";
export { ensureOmnipolymathAgentStandingIntentsSchema } from "../state/omnipolymath-agent-standing-intents-schema.js";
export {
  compileSqliteQueryBindings,
  enableNodeSqliteKyselyStatementCache,
  sqliteStringSet,
} from "../infra/kysely-sync.js";
export { resolveExistingSqliteFileUri } from "../infra/node-sqlite.js";
export { withSqliteReadOnlyInspection } from "../infra/sqlite-maintenance-inspection.js";
export {
  prepareSqliteReadOnlyLocation,
  prepareSqliteReadOnlyLocationSync,
  startSqliteReadOnlyLocationAsync,
} from "../infra/sqlite-snapshot-source.js";
export { assertTransactionUsable } from "../infra/sqlite-transaction.js";
export {
  borrowOmnipolymathAgentDatabase,
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
  iterateSqliteQuerySync,
  openNodeSqliteDatabase,
  openOmnipolymathAgentDatabase,
  prepareSqliteQuerySync,
  runOmnipolymathAgentWriteAdmission,
  runSqliteImmediateTransaction,
  runSqliteImmediateTransactionSync,
  withOmnipolymathAgentDatabaseAsync,
  withOmnipolymathAgentDatabaseWrite,
} from "./sqlite-runtime-legacy.js";
export { tableExists } from "../state/omnipolymath-state-db-schema-helpers.js";
