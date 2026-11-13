import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { isMainThread } from "node:worker_threads";
import { normalizeAgentId } from "@omnipolymath/normalization-core/agent-id";
import { isDeletedAgentDatabasePath } from "../infra/agent-database-readers.js";
import { assertEngineStoreExecutionAllowed } from "../infra/database-engine/admission-scope.js";
import { observeConnection } from "../infra/database-engine/observation.js";
import { enableNodeSqliteKyselyStatementCache } from "../infra/kysely-sync-cache-state.js";
import { openNodeSqliteDatabase, resolveExistingSqliteFileUri } from "../infra/node-sqlite.js";
import type { EngineConnection } from "../infra/sql-connection.js";
import { sqlitePrimaryResultCode } from "../infra/sqlite-error-diagnostics.js";
import {
  admitSqliteSchema,
  getAdmittedSqliteSchemaFacts,
  runSqliteReadOperationSync,
} from "../infra/sqlite-schema-facts.js";
import { SqliteSchemaMismatchError } from "../infra/sqlite-schema-issues.js";
import { openSqliteReadOnlyDatabase } from "../infra/sqlite-snapshot-source.js";
import { runSqliteReadSnapshotSync } from "../infra/sqlite-transaction.js";
import { isArtifactPreservingStateRead } from "./artifact-preserving-state-reads.js";
import { loadOmnipolymathAgentCanonicalValidationReceipt } from "./omnipolymath-agent-canonical-validation-receipt.js";
import { assertCanonicalSessionValidationSchema } from "./omnipolymath-agent-canonical-validation-schema.js";
import { hasPendingAgentStartupColumns } from "./omnipolymath-agent-db-additive-columns.js";
import type { OmnipolymathAgentDatabaseOptions } from "./omnipolymath-agent-db-contract.js";
import { agentEngineInput, openAgentEngineStore } from "./omnipolymath-agent-db-engine.js";
import { registerOmnipolymathAgentDatabaseIdentity } from "./omnipolymath-agent-db-identity.js";
import {
  classifyOmnipolymathAgentDatabaseReadError,
  recordOmnipolymathAgentDatabaseReadOpenFailure,
} from "./omnipolymath-agent-db-read-error.js";
import { registerOmnipolymathAgentDatabaseSyncResource } from "./omnipolymath-agent-db-resources.js";
import {
  assertCanonicalAgentPersistenceVersion,
  assertExistingAgentSchemaOwner,
  assertSupportedAgentSchemaVersion,
  readExistingAgentSchemaMeta,
} from "./omnipolymath-agent-db-schema-read.js";
import { revalidateAgentDatabaseTerminalOpen } from "./omnipolymath-agent-db-terminal.js";
import {
  adoptOmnipolymathAgentDatabaseSchema,
  hasOmnipolymathAgentCanonicalValidation,
} from "./omnipolymath-agent-db-validation-cache.js";
import {
  isIncognitoOmnipolymathAgentSqlitePath,
  resolveOmnipolymathAgentSqlitePath,
} from "./omnipolymath-agent-db.paths.js";
import { readOmnipolymathDatabaseQuarantineFailure } from "./omnipolymath-quarantine-store.js";
import { OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS } from "./omnipolymath-state-db-contract.js";

export type OmnipolymathAgentReadOnlyDatabase = {
  agentId: string;
  db: EngineConnection;
  path: string;
};

export type OmnipolymathAgentReadOnlyDatabaseHandle = OmnipolymathAgentReadOnlyDatabase & {
  close: () => void;
};

export type OmnipolymathAgentDatabaseReadOnlyOpenResult =
  | { found: true; database: OmnipolymathAgentReadOnlyDatabaseHandle }
  | { found: false; reason: "database-missing" | "schema-missing" };

export type OmnipolymathAgentDatabaseReadOnlyResult<T> =
  | { found: true; value: T }
  | { found: false; reason: "database-missing" | "schema-missing" };

export function readOmnipolymathAgentDatabase<T>(
  database: OmnipolymathAgentReadOnlyDatabase,
  operation: (database: OmnipolymathAgentReadOnlyDatabase) => T,
): { found: true; value: T } | { found: false; reason: "schema-missing" } {
  try {
    return runSqliteReadOperationSync(database.db, () => {
      // DDL revokes schema admission independently of the retained physical handle.
      // These assertions reuse admitted facts until that schema lifetime changes.
      return hasAdmittedAgentReadOnlySchema(database)
        ? ({ found: true, value: operation(database) } as const)
        : ({ found: false, reason: "schema-missing" } as const);
    });
  } catch (error) {
    throw sqlitePrimaryResultCode(error) === 1
      ? classifyOmnipolymathAgentDatabaseReadError(database.db, error)
      : error;
  }
}

function hasAdmittedAgentReadOnlySchema(database: OmnipolymathAgentReadOnlyDatabase): boolean {
  const userVersion = assertSupportedAgentSchemaVersion(database.db, database.path);
  const schemaMeta = readExistingAgentSchemaMeta(database.db);
  assertCanonicalAgentPersistenceVersion(database.db, database.path, userVersion);
  if (!schemaMeta) {
    return false;
  }
  assertExistingAgentSchemaOwner(schemaMeta, database.agentId, database.path);
  assertCanonicalSessionValidationSchema(database.db);
  return true;
}

/** Recheck admission and consume retained rows in the same fresh synchronous scope. */
export function hasOmnipolymathAgentReadOnlySchema(
  database: OmnipolymathAgentReadOnlyDatabase,
  onAdmitted?: () => void,
): boolean {
  return runSqliteReadOperationSync(database.db, () => {
    if (!hasAdmittedAgentReadOnlySchema(database)) {
      return false;
    }
    onAdmitted?.();
    return true;
  });
}

/** Admit ownership and consume its rows in the same freshly pinned snapshot. */
export function readOmnipolymathAgentDatabaseSnapshot<T>(
  database: OmnipolymathAgentReadOnlyDatabase,
  operation: (database: OmnipolymathAgentReadOnlyDatabase) => T,
): OmnipolymathAgentDatabaseReadOnlyResult<T> {
  let result!: OmnipolymathAgentDatabaseReadOnlyResult<T>;
  runSqliteReadSnapshotSync(database.db, () => {
    result = readOmnipolymathAgentDatabase(database, operation);
    // Keep the kernel value unwrapped so the transaction owner still rejects Promises.
    return result.found ? result.value : undefined;
  });
  return result;
}

/** Fresh-only callers do not need the writable runtime's process-held connection cache. */
export function withFreshOmnipolymathAgentDatabaseReadOnly<T>(
  operation: (database: OmnipolymathAgentReadOnlyDatabase) => T,
  options: OmnipolymathAgentDatabaseOptions,
  behavior: { allowExtension?: boolean; snapshot?: boolean } = {},
): OmnipolymathAgentDatabaseReadOnlyResult<T> {
  const opened = openOmnipolymathAgentDatabaseReadOnly(options, behavior);
  if (!opened.found) {
    return opened;
  }
  try {
    return behavior.snapshot
      ? readOmnipolymathAgentDatabaseSnapshot(opened.database, operation)
      : readOmnipolymathAgentDatabase(opened.database, operation);
  } finally {
    opened.database.close();
  }
}

/** Open one existing agent database without creating, registering, migrating, or adopting it. */
export function openOmnipolymathAgentDatabaseReadOnly(
  options: OmnipolymathAgentDatabaseOptions,
  behavior: { allowExtension?: boolean; lifecycle?: "agent" } = {},
): OmnipolymathAgentDatabaseReadOnlyOpenResult {
  const engineInput = agentEngineInput();
  if (engineInput) {
    assertEngineStoreExecutionAllowed();
  }
  const agentId = normalizeAgentId(options.agentId);
  const pathname = resolveOmnipolymathAgentSqlitePath({ ...options, agentId });
  if (isIncognitoOmnipolymathAgentSqlitePath(pathname, { agentId, env: options.env })) {
    return { found: false, reason: "database-missing" };
  }
  if (isDeletedAgentDatabasePath(pathname) || !fs.existsSync(pathname)) {
    return { found: false, reason: "database-missing" };
  }
  // Verified-corrupt generations stay quarantined for reads as well as writes:
  // the process terminal latch and the persisted generation-aware quarantine
  // row must both clear before any fresh read-only physical open proceeds.
  revalidateAgentDatabaseTerminalOpen(pathname);
  const persistedQuarantine = readOmnipolymathDatabaseQuarantineFailure("agent", pathname, {
    env: options.env,
  });
  if (persistedQuarantine) {
    recordOmnipolymathAgentDatabaseReadOpenFailure(persistedQuarantine);
    throw persistedQuarantine;
  }
  // Lock policy belongs to the open: node:sqlite has no busy handler until one
  // is set, so a later PRAGMA leaves every earlier statement unprotected.
  let db: DatabaseSync;
  try {
    db = engineInput
      ? openNodeSqliteDatabase(resolveExistingSqliteFileUri(pathname), {
          timeout: OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS,
        })
      : openSqliteReadOnlyDatabase(pathname, {
          timeout: OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS,
          ...(behavior.allowExtension ? { allowExtension: true } : {}),
        });
  } catch (error) {
    recordOmnipolymathAgentDatabaseReadOpenFailure(error);
    throw error;
  }
  let closed = false;
  let selected: EngineConnection = db;
  let unregister: (() => void) | undefined;
  const close = () => {
    if (closed) {
      return;
    }
    if (selected !== db && selected.isOpen) {
      selected.close();
    }
    if (db.isOpen) {
      db.close();
    }
    closed = true;
    unregister?.();
    unregister = undefined;
  };
  try {
    let database: OmnipolymathAgentReadOnlyDatabaseHandle;
    if (engineInput) {
      selected = openAgentEngineStore(
        db,
        agentId,
        pathname,
        true,
        (connection, error) => {
          selected = connection;
          throw error;
        },
        true,
      );
      registerOmnipolymathAgentDatabaseIdentity(selected);
      database = { agentId, db: selected, path: pathname, close };
    } else {
      observeConnection(db);
      enableNodeSqliteKyselyStatementCache(db);
      registerOmnipolymathAgentDatabaseIdentity(db);
      const privatePath = isArtifactPreservingStateRead("agent", pathname)
        ? db.location()
        : undefined;
      database = { agentId, db, path: privatePath ?? pathname, close };
      // The physical owner already checked ownership and canonical definitions.
      const hasSchema =
        adoptOmnipolymathAgentDatabaseSchema(database) ||
        runSqliteReadOperationSync(db, () => {
          admitSqliteSchema(db);
          if (!hasAdmittedAgentReadOnlySchema(database)) {
            return false;
          }
          const schema = getAdmittedSqliteSchemaFacts(database.db);
          if (schema && hasPendingAgentStartupColumns(schema.tableSql)) {
            throw new SqliteSchemaMismatchError(
              `Omnipolymath agent database ${database.path} requires writable startup admission before session reads; restart the Gateway or run omnipolymath doctor --fix.`,
            );
          }
          return true;
        });
      if (!hasSchema) {
        close();
        return { found: false, reason: "schema-missing" };
      }
      // Worker admission loads file-bound proof before a read transaction prevents it.
      if (!isMainThread) {
        loadOmnipolymathAgentCanonicalValidationReceipt(database);
        hasOmnipolymathAgentCanonicalValidation(database);
      }
    }
    if (behavior.lifecycle === "agent") {
      unregister = registerOmnipolymathAgentDatabaseSyncResource({
        agentId,
        path: pathname,
        revoke: close,
        close,
      });
    }
    return { found: true, database };
  } catch (error) {
    close();
    recordOmnipolymathAgentDatabaseReadOpenFailure(error);
    throw error;
  }
}
