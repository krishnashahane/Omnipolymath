import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import { isPostgresSqlConnection } from "../infra/sql-connection.js";
import { readSqliteBusyTimeout } from "../infra/sqlite-busy-timeout.js";
import { withSqlitePostCommitPublications } from "../infra/sqlite-post-commit.js";
import {
  runSqliteImmediateTransaction,
  type SqliteTransactionOptions,
} from "../infra/sqlite-transaction.js";
import {
  assertAgentDeletionDatabaseCleanupAccess,
  getAgentDeletionDatabaseCleanup,
} from "./agent-deletion-cleanup.js";
import { retainAgentDatabase } from "./omnipolymath-agent-db-borrower.js";
import type {
  OmnipolymathAgentDatabase,
  OmnipolymathAgentDatabaseOptions,
} from "./omnipolymath-agent-db-contract.js";
import { getOmnipolymathAgentDatabaseIfOpen, openOmnipolymathAgentDatabase } from "./omnipolymath-agent-db.js";

/** Yield only for BEGIN admission; admitted writes and publications are never replayed. */
export async function runOmnipolymathAgentWriteWithYieldingAdmission<T>(
  operation: (database: OmnipolymathAgentDatabase) => T,
  options: OmnipolymathAgentDatabaseOptions,
  transactionOptions: Pick<
    SqliteTransactionOptions,
    "operationLabel" | "slowTransactionHoldMs"
  > = {},
): Promise<T | undefined> {
  const captured = {
    ...options,
    env: cloneEnvWithPlatformSemantics(options.env ?? process.env),
  };
  const database = openOmnipolymathAgentDatabase(captured);
  captured.path = database.path;
  const release = retainAgentDatabase(database.db);
  try {
    return await runSqliteImmediateTransaction(
      database.db,
      async () => () => {
        assertAgentDeletionDatabaseCleanupAccess(database, captured);
        return operation(database);
      },
      {
        ...transactionOptions,
        ...(isPostgresSqlConnection(database.db)
          ? {}
          : { busyTimeoutMs: readSqliteBusyTimeout(database.db) }),
        databaseLabel: database.path,
        operationLabel: transactionOptions.operationLabel ?? "agent.write",
        withCommit: getAgentDeletionDatabaseCleanup(captured)?.withCommit,
      },
      (write) => {
        if (getOmnipolymathAgentDatabaseIfOpen(captured) !== database) {
          throw new Error(`Agent database closed or replaced before write: ${database.path}`);
        }
        // BEGIN yields; admitted writes retain the connection's bounded COMMIT wait for readers.
        return withSqlitePostCommitPublications(database.db, write);
      },
    );
  } finally {
    release();
  }
}
