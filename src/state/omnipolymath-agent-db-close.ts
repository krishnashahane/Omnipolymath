import { statSync } from "node:fs";
import {
  assertNodeSqliteDisposalAllowed,
  disposeNodeSqliteDependents,
} from "../infra/kysely-sync-cache-state.js";
import { isPostgresSqlConnection, sqlPublicationAnchor } from "../infra/sql-connection.js";
import { setSqliteBusyTimeout } from "../infra/sqlite-busy-timeout.js";
import {
  prepareSqliteDatabaseCleanClose,
  revokeSqliteDatabaseAdmissionsForPath,
} from "../infra/sqlite-database-admission.js";
import { releaseAgentCreationClaimHandle } from "./agent-creation-claim.js";
import { releaseAgentDeletionDatabaseCleanup } from "./agent-deletion-cleanup.js";
import type { OmnipolymathAgentDatabase } from "./omnipolymath-agent-db-contract.js";
import {
  isOmnipolymathAgentDatabasePathCurrent,
  readOmnipolymathAgentDatabaseIdentity,
} from "./omnipolymath-agent-db-identity.js";
import { releaseOmnipolymathAgentDatabaseLease } from "./omnipolymath-agent-db-lease.js";
import { invalidateOmnipolymathAgentDatabaseValidation } from "./omnipolymath-agent-db-validation-cache.js";

/** Include the asynchronous maintenance join in the native owner's close receipt. */
export async function stopAgentDatabaseWalMaintenance(
  database: OmnipolymathAgentDatabase,
): Promise<void> {
  const startedAt = performance.now();
  await database.walMaintenance.stop();
  database.closeTiming = { startedAt, walStopMs: performance.now() - startedAt };
}

/** Native handle close uses the lifecycle owner's existing leases and validation. */
export function createAgentDatabaseHandleCloser(cache: {
  leases: Map<string, { leaseId: string; env: NodeJS.ProcessEnv }>;
  failures: ReadonlyMap<string, unknown>;
  idleTimers: WeakMap<OmnipolymathAgentDatabase["db"], Disposable>;
}) {
  return function closeCachedOmnipolymathAgentDatabase(database: OmnipolymathAgentDatabase): void {
    const timing = database.closeTiming ?? { startedAt: performance.now() };
    delete database.closeTiming;
    // Retiring handles checkpoint once without waiting for peer readers.
    const lease = cache.leases.get(database.path);
    const alreadyClosed = !database.db.isOpen;
    const priorCheckpointError = database.walMaintenance.health?.state === "error";
    const postgres = isPostgresSqlConnection(database.db);
    const anchor = sqlPublicationAnchor(database.db);
    assertNodeSqliteDisposalAllowed(anchor);
    using seal = !alreadyClosed && !postgres ? prepareSqliteDatabaseCleanClose(anchor) : undefined;
    let clean: { path: string; publishSeal: () => boolean } | undefined;
    let retainRuntimeProof: boolean;
    try {
      if (!alreadyClosed && !postgres) {
        setSqliteBusyTimeout(anchor, 0);
      }
      disposeNodeSqliteDependents(anchor);
      const checkpointAt = performance.now();
      database.walMaintenance.close({ checkpointMode: "TRUNCATE" });
      timing.checkpointMs = performance.now() - checkpointAt;
      const healthy =
        !cache.failures.has(database.path) &&
        !priorCheckpointError &&
        database.walMaintenance.health?.state !== "error";
      const pathCurrent = !alreadyClosed && healthy && isOmnipolymathAgentDatabasePathCurrent(database);
      // Healthy peer handles keep runtime proof; restart proof still needs an empty WAL.
      retainRuntimeProof = healthy && (alreadyClosed || pathCurrent);
      const nativeCloseAt = performance.now();
      if (database.db.isOpen) {
        database.db.close();
      }
      if (postgres && anchor.isOpen) {
        anchor.close();
      }
      timing.nativeCloseMs = performance.now() - nativeCloseAt;
      if (pathCurrent && !postgres) {
        const { canonicalPath } = readOmnipolymathAgentDatabaseIdentity(database);
        // Native last-close may finish a checkpoint; a pinned WAL must remain unsealed.
        const closedWithEmptyWal =
          (statSync(`${canonicalPath}-wal`, { throwIfNoEntry: false })?.size ?? 0) === 0;
        if (seal && closedWithEmptyWal) {
          clean = { path: database.path, publishSeal: seal.publish };
        }
      }
    } catch (error) {
      if (lease) {
        invalidateOmnipolymathAgentDatabaseValidation(database.path);
        revokeSqliteDatabaseAdmissionsForPath(database.path);
      }
      throw error;
    }
    if (lease) {
      releaseOmnipolymathAgentDatabaseLease(
        lease.leaseId,
        { env: lease.env, initializationAgentPaths: [database.path] },
        clean ??
          (retainRuntimeProof ? (postgres ? "postgres-closed" : "uncheckpointed") : undefined),
        timing,
      );
      cache.leases.delete(database.path);
    }
    releaseAgentDeletionDatabaseCleanup(database);
    releaseAgentCreationClaimHandle(database);
    cache.idleTimers.get(database.db)?.[Symbol.dispose]();
    cache.idleTimers.delete(database.db);
  };
}
