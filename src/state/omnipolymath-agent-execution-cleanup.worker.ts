import type { SqliteWorkerCommand } from "../infra/sqlite-worker-contract.js";
import { requestSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import { releaseExitedOmnipolymathAgentDatabaseLeaseInDatabase } from "./omnipolymath-agent-db-lease.js";
import { requireOmnipolymathStateDatabaseIdentity } from "./omnipolymath-state-db-cache.js";
import type { OmnipolymathStateDatabase } from "./omnipolymath-state-db-contract.js";
import { runOmnipolymathStateWriteTransaction } from "./omnipolymath-state-db.js";
import type { OmnipolymathStateWorkerCleanupOperations } from "./omnipolymath-state-worker-contract.js";

export function executeAgentDatabaseCleanupCommand(
  command: SqliteWorkerCommand<
    Pick<OmnipolymathStateWorkerCleanupOperations, "agentDatabases.releaseExitedLease">
  >,
  database: OmnipolymathStateDatabase,
  env: NodeJS.ProcessEnv,
): void {
  runOmnipolymathStateWriteTransaction(
    (current) => {
      if (
        current.path !== command.input.sharedStatePath ||
        requireOmnipolymathStateDatabaseIdentity(current).key !== command.input.sharedStateIdentity
      ) {
        throw new Error("Retired agent cleanup cannot adopt a replacement shared database");
      }
      releaseExitedOmnipolymathAgentDatabaseLeaseInDatabase(
        current.db,
        command.input,
        command.input.outcome,
        () =>
          requestSqliteWorkerOperationAdmission({
            stage: "prepare",
            facts: "agent-integrity-invalidated",
          }),
      );
    },
    { database, path: database.path, env },
  );
}
