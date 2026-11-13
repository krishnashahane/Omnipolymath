import type { EngineConnection } from "../infra/sql-connection.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import {
  assertAgentCreationClaimAccess,
  assertAgentCreationClaimAliases,
} from "./agent-creation-claim.js";
import {
  AgentDatabaseAdmissionError,
  readAgentDatabaseAdmissionRefusal,
  readAgentDatabaseReadAdmissionRefusal,
} from "./agent-database-admission.js";
import {
  assertAgentDeletionCleanupAliases,
  assertAgentDeletionDatabaseCleanupAccess,
} from "./agent-deletion-cleanup.js";
import type {
  OmnipolymathAgentDatabase,
  OmnipolymathAgentDatabaseOptions,
} from "./omnipolymath-agent-db-contract.js";
import { findOmnipolymathAgentDatabaseIdentity } from "./omnipolymath-agent-db-identity.js";
import {
  isSameOmnipolymathAgentDatabasePath,
  resolveOmnipolymathAgentSqlitePath,
} from "./omnipolymath-agent-db.paths.js";
import { observeOmnipolymathDatabaseMaintenanceResource } from "./omnipolymath-state-maintenance-context.js";

// The writable lifecycle alone publishes handles/failures and installs or disposes timers.
// Readers share its pins and activity without importing opening, migration, or close machinery.
type AgentDatabaseBorrowers = {
  databases: Map<string, OmnipolymathAgentDatabase>;
  borrowers: WeakMap<EngineConnection, Set<object>>;
  idleTimers: WeakMap<EngineConnection, Disposable & { refresh(): void }>;
  failures: Map<string, unknown>;
  refreshIdleTimer?: (database: OmnipolymathAgentDatabase) => void;
};

export const agentDatabaseBorrowers = resolveGlobalSingleton<AgentDatabaseBorrowers>(
  Symbol.for("omnipolymath.agentDatabaseBorrowers"),
  () => ({
    databases: new Map<string, OmnipolymathAgentDatabase>(),
    borrowers: new WeakMap<EngineConnection, Set<object>>(),
    idleTimers: new WeakMap<EngineConnection, Disposable & { refresh(): void }>(),
    failures: new Map<string, unknown>(),
  }),
);

const cache = agentDatabaseBorrowers;

export function retainAgentDatabase(db: EngineConnection): () => void {
  observeOmnipolymathDatabaseMaintenanceResource(db);
  const borrowers = cache.borrowers.get(db) ?? new Set<object>();
  const borrower = {};
  borrowers.add(borrower);
  cache.borrowers.set(db, borrowers);
  return () => {
    if (borrowers.delete(borrower) && borrowers.size === 0) {
      cache.idleTimers.get(db)?.refresh();
    }
  };
}

/** Return the matching live cache entry without materializing a database. */
export function getOmnipolymathAgentDatabaseIfOpen(
  options: OmnipolymathAgentDatabaseOptions,
): OmnipolymathAgentDatabase | undefined {
  const agentId = normalizeAgentId(options.agentId);
  // Early readers must open a read-only handle, never borrow the preparing writer.
  const refusal = readAgentDatabaseAdmissionRefusal(agentId, options);
  if (refusal) {
    if (readAgentDatabaseReadAdmissionRefusal(agentId, options)) {
      throw new AgentDatabaseAdmissionError(refusal);
    }
    return undefined;
  }
  const pathname = resolveOmnipolymathAgentSqlitePath({ ...options, agentId });
  const database = cache.databases.get(pathname);
  if (!database?.db.isOpen) {
    assertAgentDeletionCleanupAliases(options, isSameOmnipolymathAgentDatabasePath);
    assertAgentCreationClaimAliases(options);
    return undefined;
  }
  if (cache.failures.has(pathname)) {
    throw cache.failures.get(pathname);
  }
  if (database.agentId !== agentId) {
    throw new Error(
      `Omnipolymath agent database ${pathname} is already open for agent ${database.agentId}; requested agent ${agentId}.`,
    );
  }
  assertAgentDeletionDatabaseCleanupAccess(database, options);
  assertAgentCreationClaimAccess(database, options);
  observeOmnipolymathDatabaseMaintenanceResource(database.db);
  cache.refreshIdleTimer?.(database);
  return database;
}

/** Commit receipts invalidate every current handle of the captured physical database. */
export function invalidateOmnipolymathAgentWritableProjections(
  databaseIdentity: string,
  invalidate: (database: EngineConnection) => void,
): void {
  for (const database of cache.databases.values()) {
    if (findOmnipolymathAgentDatabaseIdentity(database)?.identity === databaseIdentity) {
      invalidate(database.db);
    }
  }
}
