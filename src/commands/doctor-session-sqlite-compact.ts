/** Runs doctor-owned SQLite file compaction for migrated session stores. */
import fs from "node:fs";
import { safeStatSync } from "@openclaw/fs-safe/path";
import type { SessionStoreTarget } from "../config/sessions/targets.js";
import { resolveTargetSqliteOptions } from "../infra/session-sqlite-migration-readers.js";
import { invalidateOmnipolymathAgentDatabaseIntegrityBeforeMutation } from "../state/omnipolymath-agent-db-lease.js";
import { withAgentDatabaseMaintenanceLease } from "../state/omnipolymath-agent-db-maintenance-lease.js";
import {
  assertOmnipolymathAgentDatabaseForMaintenance,
  migrateOmnipolymathAgentDatabaseForMaintenance,
} from "../state/omnipolymath-agent-db-maintenance.js";
import { ensureOmnipolymathAgentDatabasePermissions } from "../state/omnipolymath-agent-db-permissions.js";
import {
  clearOmnipolymathAgentDatabaseOpenFailure,
  isOmnipolymathAgentDatabaseOpen,
  resolveOmnipolymathAgentSqlitePath,
} from "../state/omnipolymath-agent-db.js";
import type { DoctorSessionSqliteCompactReport } from "./doctor-session-sqlite-types.js";
import { compactDoctorSqliteFile } from "./doctor-sqlite-compact.js";

export async function compactDoctorSessionSqliteTarget(
  target: SessionStoreTarget,
  options: { env?: NodeJS.ProcessEnv; operation?: "import-finalize" } = {},
): Promise<DoctorSessionSqliteCompactReport> {
  const databaseOptions = resolveTargetSqliteOptions(target, options.env);
  const sqlitePath = resolveOmnipolymathAgentSqlitePath(databaseOptions);
  const walSizeBytes = safeStatSync(`${sqlitePath}-wal`)?.size ?? 0;
  const stat = fs.lstatSync(sqlitePath, { throwIfNoEntry: false });
  if (!stat) {
    return {
      dbSizeAfterBytes: 0,
      dbSizeBeforeBytes: 0,
      freelistAfterPages: 0,
      freelistBeforePages: 0,
      pageSizeBytes: 0,
      reclaimedBytes: 0,
      skipped: true,
      walSizeAfterBytes: walSizeBytes,
      walSizeBeforeBytes: walSizeBytes,
    };
  }
  if (!stat.isFile()) {
    throw new Error(`Omnipolymath agent database is not a regular file: ${sqlitePath}`);
  }
  if (isOmnipolymathAgentDatabaseOpen(sqlitePath)) {
    throw new Error(
      `Omnipolymath agent database ${sqlitePath} is already open in this process. Stop Omnipolymath and retry.`,
    );
  }
  const requireQuarantineCleared = () => {
    if (!clearOmnipolymathAgentDatabaseOpenFailure(sqlitePath, { env: options.env })) {
      throw new Error(
        `Omnipolymath agent database ${sqlitePath} was repaired, but its persisted quarantine record could not be cleared. Rerun omnipolymath doctor --fix so the database is not refused again.`,
      );
    }
  };
  const compactTarget = () => {
    invalidateOmnipolymathAgentDatabaseIntegrityBeforeMutation(sqlitePath);
    const compact = compactDoctorSqliteFile({
      operation: options.operation,
      afterSuccess: () => {
        requireQuarantineCleared();
        ensureOmnipolymathAgentDatabasePermissions(sqlitePath, databaseOptions);
      },
      sqlitePath,
      validateBeforeMutation: (database) =>
        assertOmnipolymathAgentDatabaseForMaintenance(database, {
          agentId: databaseOptions.agentId,
          pathname: sqlitePath,
        }),
    });
    return {
      dbSizeAfterBytes: compact.after.dbSizeBytes,
      dbSizeBeforeBytes: compact.before.dbSizeBytes,
      freelistAfterPages: compact.after.freelistPages,
      freelistBeforePages: compact.before.freelistPages,
      pageSizeBytes: compact.before.pageSizeBytes || compact.after.pageSizeBytes,
      reclaimedBytes: compact.reclaimedBytes,
      skipped: false,
      walSizeAfterBytes: compact.after.walSizeBytes,
      walSizeBeforeBytes: compact.before.walSizeBytes,
    };
  };
  // The maintenance lease lives in shared state; never forward the agent database path.
  return options.operation === "import-finalize"
    ? withAgentDatabaseMaintenanceLease({ env: databaseOptions.env }, async (maintenance) => {
        await migrateOmnipolymathAgentDatabaseForMaintenance(
          { agentId: databaseOptions.agentId, pathname: sqlitePath },
          maintenance,
        );
        maintenance.assertOwned();
        requireQuarantineCleared();
        return compactTarget();
      })
    : compactTarget();
}
