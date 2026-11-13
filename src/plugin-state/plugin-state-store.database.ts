import { hasErrnoCode } from "../infra/errno.js";
import { sqlPublicationAnchor } from "../infra/sql-connection.js";
import { isTerminalSqliteIntegrityError } from "../infra/sqlite-integrity.js";
import { stageSqliteTransactionState } from "../infra/sqlite-post-commit.js";
import { isSqliteSchemaVersionError } from "../infra/sqlite-user-version.js";
import { readTrackedStateDatabaseIdentity } from "../state/omnipolymath-state-db-handle.js";
import { withExistingOmnipolymathStateDatabaseReadOnly } from "../state/omnipolymath-state-db-readonly.js";
import { hasOmnipolymathStateTablesBeyondStartupCheckpoint } from "../state/omnipolymath-state-db-schema-helpers.js";
import {
  isOmnipolymathStateDatabaseOpen,
  openOmnipolymathStateDatabase,
  runOmnipolymathStateWriteTransaction,
  type OmnipolymathStateDatabaseOptions,
} from "../state/omnipolymath-state-db.js";
import {
  resolveDatabasePath,
  resolveOmnipolymathStateSqlitePath,
} from "../state/omnipolymath-state-db.paths.js";
import { beginPluginStatePublication } from "./plugin-state-publication.js";
import { createPluginStateError, type PluginStateDatabase } from "./plugin-state-store.kernel.js";
import {
  PluginStateStoreError,
  type PluginStateStoreErrorCode,
  type PluginStateStoreOperation,
} from "./plugin-state-store.types.js";
export function wrapPluginStateError(
  error: unknown,
  operation: PluginStateStoreOperation,
  fallbackCode: PluginStateStoreErrorCode,
  message: string,
  pathname = resolveOmnipolymathStateSqlitePath(process.env),
): PluginStateStoreError {
  if (error instanceof PluginStateStoreError) {
    return error;
  }
  let publicMessage = message;
  // Only owner-classified failures get public hints. Cause messages can contain
  // database paths, SQL, or stored values and must stay out of this message.
  if (fallbackCode === "PLUGIN_STATE_OPEN_FAILED") {
    if (isSqliteSchemaVersionError(error)) {
      publicMessage +=
        "\nThe state database uses a newer schema. Run an Omnipolymath build that supports it.";
    } else if (error instanceof Error && isTerminalSqliteIntegrityError(error)) {
      publicMessage +=
        "\nDatabase integrity verification failed. Restore or repair the state database, then run omnipolymath doctor --fix.";
    }
  }
  return createPluginStateError({
    code: fallbackCode,
    operation,
    message: publicMessage,
    path: pathname,
    cause: error,
  });
}

function openPluginStateDatabase(
  operation: PluginStateStoreOperation = "open",
  options: OmnipolymathStateDatabaseOptions = {},
): PluginStateDatabase {
  const env = options.env ?? process.env;
  const pathname = resolveOmnipolymathStateSqlitePath(env);
  try {
    return openOmnipolymathStateDatabase(options);
  } catch (error) {
    throw wrapPluginStateError(
      error,
      operation,
      "PLUGIN_STATE_OPEN_FAILED",
      "Failed to open the plugin state database.",
      pathname,
    );
  }
}

export function isMissingPluginStateTableError(error: unknown): boolean {
  return (
    error instanceof Error &&
    ((hasErrnoCode(error, "ERR_SQLITE_ERROR") &&
      error.message === "no such table: plugin_state_entries") ||
      (hasErrnoCode(error, "42P01") &&
        error.message === 'relation "plugin_state_entries" does not exist'))
  );
}

/** Read plugin state without joining the shared writable database lifecycle. */
export function withPluginStateDatabaseReadOnly<T>(
  operationName: PluginStateStoreOperation,
  operation: (store: PluginStateDatabase) => T,
  options: OmnipolymathStateDatabaseOptions = {},
): T | undefined {
  const pathname = resolveDatabasePath(options);
  let operationStarted = false;
  try {
    return withExistingOmnipolymathStateDatabaseReadOnly(({ db, path }) => {
      operationStarted = true;
      try {
        return operation({ db, path });
      } catch (error) {
        if (isMissingPluginStateTableError(error)) {
          // The lease bootstrap creates exactly schema_meta + state_leases before the first write;
          // any other table means the missing plugin-state table is damage, not fresh state.
          if (!hasOmnipolymathStateTablesBeyondStartupCheckpoint(db)) {
            return undefined;
          }
        }
        throw error;
      }
    }, options);
  } catch (error) {
    if (!operationStarted) {
      throw wrapPluginStateError(
        error,
        operationName,
        "PLUGIN_STATE_OPEN_FAILED",
        "Failed to open the plugin state database.",
        pathname,
      );
    }
    throw error;
  }
}
export function runWriteTransaction<T>(
  operation: PluginStateStoreOperation,
  write: (store: PluginStateDatabase) => T,
  options: OmnipolymathStateDatabaseOptions = {},
): T {
  // Only cold acquisition failures are open errors. A held owner's ownership or
  // transaction failure must remain a write error, with its callback supplying the handle.
  if (!isOmnipolymathStateDatabaseOpen(resolveOmnipolymathStateSqlitePath(options.env ?? process.env))) {
    openPluginStateDatabase(operation, options);
  }
  return runOmnipolymathStateWriteTransaction(
    (store) => {
      const identity = readTrackedStateDatabaseIdentity(sqlPublicationAnchor(store.db))?.key;
      if (!identity) {
        throw new Error("Plugin state writer has no admitted source");
      }
      const publication = beginPluginStatePublication(() => identity);
      // Savepoints keep denial until the outer owner installs all committed facts.
      stageSqliteTransactionState(sqlPublicationAnchor(store.db), {
        stage() {},
        commit() {},
        prepareObservers: () => publication.finish("completed"),
        rollback: () => publication.finish("completed"),
        invalidate: () => publication.finish("unknown"),
      });
      return write(store);
    },
    options,
    {
      operationLabel: `pluginState.${operation}`,
    },
  );
}
