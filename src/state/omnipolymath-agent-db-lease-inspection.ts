import fs from "node:fs";
import path from "node:path";
import { withEngineStoreAdmission } from "../infra/database-engine/admission-scope.js";
import { hasErrnoCode } from "../infra/errno.js";
import type { EngineConnection } from "../infra/sql-connection.js";
import { isPostgresSqlConnection } from "../infra/sql-connection.js";
import { runWithSqliteBusyTimeout } from "../infra/sqlite-busy-timeout.js";
import { resolveSqliteInspectionSignal } from "../infra/sqlite-readonly-worker.js";
import { prepareSqliteReadOnlyLocation } from "../infra/sqlite-snapshot-source.js";
import { isLiveStateRead } from "./artifact-preserving-state-reads.js";
import { createAgentDatabaseLeaseStaleReasonReader } from "./omnipolymath-agent-db-lease-provenance.js";
import {
  OmnipolymathAgentDatabaseLeaseActiveError,
  readAgentDatabaseLeases,
} from "./omnipolymath-agent-db-lease.js";
import { omnipolymathStateDatabaseCache } from "./omnipolymath-state-db-cache.js";
import type {
  OmnipolymathStateDatabaseOptions,
  OmnipolymathStateSchemaReadAdmission,
} from "./omnipolymath-state-db-contract.js";
import { isStatePostgres } from "./omnipolymath-state-db-engine.js";
import { withOmnipolymathStateReadOnlyLocation } from "./omnipolymath-state-db-read-connection.js";
import { tableExists } from "./omnipolymath-state-db-schema-helpers.js";
import { resolveOmnipolymathStateSqlitePath } from "./omnipolymath-state-db.paths.js";

/** Read-only diagnostic observation; an empty result never grants maintenance authority. */
export async function readActiveOmnipolymathAgentDatabaseLeasesReadOnly(
  options: OmnipolymathStateDatabaseOptions = {},
  admitSchema?: OmnipolymathStateSchemaReadAdmission,
  signal = resolveSqliteInspectionSignal(),
): Promise<ReturnType<typeof readAgentDatabaseLeases>> {
  signal?.throwIfAborted();
  const pathname = path.resolve(options.path ?? resolveOmnipolymathStateSqlitePath(options.env));
  try {
    await fs.promises.stat(pathname);
  } catch (error) {
    if (hasErrnoCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
  // Doctor must inspect a restored database before clearing its quarantine receipt.
  const cached = omnipolymathStateDatabaseCache.isOmnipolymathStateDatabaseOpen(pathname)
    ? omnipolymathStateDatabaseCache.getOmnipolymathStateDatabaseIfOpenAtPath(pathname)
    : undefined;
  if (!cached) {
    const prepared =
      isStatePostgres() || isLiveStateRead()
        ? undefined
        : await prepareSqliteReadOnlyLocation(pathname, {
            signal,
            preserveSourceArtifacts: true,
            requireCleanup: true,
            reuse: true,
          });
    try {
      signal?.throwIfAborted();
      return withEngineStoreAdmission(() =>
        withOmnipolymathStateReadOnlyLocation(
          ({ db }) => readActiveOmnipolymathAgentDatabaseLeasesInDatabase(db),
          pathname,
          prepared?.location ?? pathname,
          admitSchema,
          undefined,
          prepared?.cleanupRoot,
        ),
      );
    } finally {
      await prepared?.cleanupAsync();
    }
  }
  signal?.throwIfAborted();
  return withEngineStoreAdmission(() => {
    const closeAdmission = isPostgresSqlConnection(cached.db)
      ? undefined
      : admitSchema?.(cached.db);
    try {
      return readActiveOmnipolymathAgentDatabaseLeasesInDatabase(cached.db);
    } finally {
      closeAdmission?.();
    }
  });
}

/** A held shared-state transaction can inspect its own leases without another reader. */
export function readActiveOmnipolymathAgentDatabaseLeasesInDatabase(database: EngineConnection) {
  const read = () => {
    if (!tableExists(database, "agent_database_leases")) {
      return [];
    }
    const staleReasonFor = createAgentDatabaseLeaseStaleReasonReader();
    return readAgentDatabaseLeases(database).filter((row) => !staleReasonFor(row));
  };
  return isPostgresSqlConnection(database) ? read() : runWithSqliteBusyTimeout(database, 250, read);
}

/** Doctor holds both lifecycle coordinators before checking writers, without schema repair. */
export async function assertNoOmnipolymathAgentDatabaseLeasesReadOnly(
  options: OmnipolymathStateDatabaseOptions = {},
  admitSchema?: OmnipolymathStateSchemaReadAdmission,
  signal?: AbortSignal,
): Promise<void> {
  const owners = await readActiveOmnipolymathAgentDatabaseLeasesReadOnly(options, admitSchema, signal);
  const [owner] = owners;
  if (owner) {
    throw new OmnipolymathAgentDatabaseLeaseActiveError(
      `Agent ${owner.agent_id} database is still open in process ${owner.owner_pid}; stop the Gateway and other Omnipolymath processes, or reboot, then rerun omnipolymath doctor --fix.`,
      [...new Set(owners.map((row) => row.owner_pid))],
    );
  }
}
