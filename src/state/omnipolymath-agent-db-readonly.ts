import { registerNodeSqliteDisposeCallback } from "../infra/kysely-sync-cache-state.js";
import { sqlPublicationAnchor, type EngineConnection } from "../infra/sql-connection.js";
import { runSqliteReadOperationSync } from "../infra/sqlite-schema-facts.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { isArtifactPreservingStateRead } from "./artifact-preserving-state-reads.js";
import {
  getOmnipolymathAgentDatabaseIfOpen,
  retainAgentDatabase,
} from "./omnipolymath-agent-db-borrower.js";
import type {
  OmnipolymathAgentDatabase,
  OmnipolymathAgentDatabaseOptions,
} from "./omnipolymath-agent-db-contract.js";
import {
  createOmnipolymathAgentDatabaseClaim,
  type OmnipolymathAgentDatabaseClaim,
} from "./omnipolymath-agent-db-identity.js";
import {
  openOmnipolymathAgentDatabaseReadOnly,
  readOmnipolymathAgentDatabase,
  readOmnipolymathAgentDatabaseSnapshot,
  withFreshOmnipolymathAgentDatabaseReadOnly,
  type OmnipolymathAgentDatabaseReadOnlyResult,
  type OmnipolymathAgentReadOnlyDatabase,
} from "./omnipolymath-agent-db-readonly-open.js";
import {
  retainCachedOmnipolymathAgentDatabaseReadOnly,
  withScopedOmnipolymathAgentDatabaseReadOnly,
  type OmnipolymathAgentDatabaseReadOnlyBehavior,
  OmnipolymathAgentDatabaseReadOnlyScope,
} from "./omnipolymath-agent-db-readonly-scope.js";
import {
  isIncognitoOmnipolymathAgentSqlitePath,
  resolveOmnipolymathAgentSqlitePath,
} from "./omnipolymath-agent-db.paths.js";

const companions = resolveGlobalSingleton(
  Symbol.for("omnipolymath.agentDatabaseReadOnlyCompanions"),
  () => new WeakMap<EngineConnection, OmnipolymathAgentDatabaseReadOnlyScope>(),
);

export {
  openOmnipolymathAgentDatabaseReadOnly,
  type OmnipolymathAgentReadOnlyDatabase,
} from "./omnipolymath-agent-db-readonly-open.js";

/**
 * Look up a process-held handle without adopting writer-side failures.
 *
 * Read-only reads are meant to survive a latched open failure or an ownership
 * mismatch that only the writable lifecycle cares about; those callers fall
 * back to a fresh connection, which reports the precise reason.
 */
function findOpenAgentDatabase(
  options: OmnipolymathAgentDatabaseOptions,
): OmnipolymathAgentDatabase | undefined {
  try {
    return getOmnipolymathAgentDatabaseIfOpen(options);
  } catch {
    return undefined;
  }
}

/** Retain an existing store across awaits without materializing a writable database. */
export function retainOmnipolymathAgentDatabaseReadOnly(
  options: OmnipolymathAgentDatabaseOptions,
):
  | { found: true; database: OmnipolymathAgentReadOnlyDatabase; claim: OmnipolymathAgentDatabaseClaim }
  | { found: false; reason: "database-missing" | "schema-missing" } {
  if (isArtifactPreservingStateRead("agent", resolveOmnipolymathAgentSqlitePath(options))) {
    const inspected = openOmnipolymathAgentDatabaseReadOnly(options);
    return inspected.found
      ? {
          found: true,
          database: inspected.database,
          claim: createOmnipolymathAgentDatabaseClaim(inspected.database, inspected.database.close),
        }
      : inspected;
  }
  const opened = findOpenAgentDatabase(options);
  if (opened && !opened.db.isTransaction) {
    return {
      found: true,
      database: opened,
      claim: createOmnipolymathAgentDatabaseClaim(opened, retainAgentDatabase(opened.db)),
    };
  }
  const agentId = normalizeAgentId(options.agentId);
  const pathname = resolveOmnipolymathAgentSqlitePath({ ...options, agentId });
  return retainCachedOmnipolymathAgentDatabaseReadOnly({ ...options, agentId, path: pathname });
}

/** Read agent state without creating, registering, migrating, or joining its writable lifecycle. */
export function withOmnipolymathAgentDatabaseReadOnly<T>(
  operation: (database: OmnipolymathAgentReadOnlyDatabase) => T,
  options: OmnipolymathAgentDatabaseOptions,
  behavior: OmnipolymathAgentDatabaseReadOnlyBehavior = {},
): OmnipolymathAgentDatabaseReadOnlyResult<T> {
  const agentId = normalizeAgentId(options.agentId);
  const pathname = resolveOmnipolymathAgentSqlitePath({ ...options, agentId });
  if (isArtifactPreservingStateRead("agent", pathname)) {
    return withFreshOmnipolymathAgentDatabaseReadOnly(operation, options, behavior);
  }
  if (isIncognitoOmnipolymathAgentSqlitePath(pathname, { agentId, env: options.env })) {
    return { found: false, reason: "database-missing" };
  }
  // Borrow only outside a transaction so readers see committed rows.
  // The writer owns reused handles; this call closes only fresh connections.
  const processOpened = behavior.allowExtension
    ? undefined
    : findOpenAgentDatabase({ ...options, agentId });
  if (processOpened?.db.isTransaction) {
    /** Keep committed reads separate from the writer using the ordinary reader lifecycle. */
    const companionOptions = { ...options, agentId };
    let scope = companions.get(processOpened.db);
    if (!scope) {
      scope = new OmnipolymathAgentDatabaseReadOnlyScope(true);
      const owned = scope;
      registerNodeSqliteDisposeCallback(sqlPublicationAnchor(processOpened.db), () =>
        owned.close(),
      );
      companions.set(processOpened.db, scope);
    }
    const owned = scope;
    return owned.run({ agentId: processOpened.agentId, path: processOpened.path }, () =>
      owned.read(operation, companionOptions, behavior),
    );
  }
  if (!processOpened) {
    return withScopedOmnipolymathAgentDatabaseReadOnly(
      operation,
      { ...options, agentId, path: pathname },
      behavior,
    );
  }
  if (behavior.snapshot) {
    return readOmnipolymathAgentDatabaseSnapshot(processOpened, operation);
  }
  // The migration owner publishes changes to the handle's shared schema admission.
  return runSqliteReadOperationSync(processOpened.db, () =>
    readOmnipolymathAgentDatabase(processOpened, operation),
  );
}
