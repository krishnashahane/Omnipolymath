import fs from "node:fs";
import { resolveSqliteDatabaseFilePaths } from "../infra/sqlite-files.js";
import { clearOmnipolymathDatabaseQuarantine } from "../state/omnipolymath-quarantine-store.js";
import {
  assertOmnipolymathStateDatabaseForMaintenance,
  clearOmnipolymathStateDatabaseOpenFailure,
  ensureOmnipolymathStatePermissions,
  isOmnipolymathStateDatabaseOpen,
} from "../state/omnipolymath-state-db.js";
import { resolveOmnipolymathStateSqlitePath } from "../state/omnipolymath-state-db.paths.js";
import { assertOmnipolymathStateWriteAllowed } from "../state/omnipolymath-state-ownership.js";
import { compactDoctorSqliteFile } from "./doctor-sqlite-compact.js";
import { withDoctorSqliteMaintenanceLock } from "./doctor-sqlite-maintenance-lock.js";

/** Compact only the canonical shared state database resolved for this invocation. */
export async function runDoctorStateSqliteCompact(options: { env?: NodeJS.ProcessEnv } = {}) {
  const env = options.env ?? process.env;
  const sqlitePath = resolveOmnipolymathStateSqlitePath(env);
  const stat = fs.lstatSync(sqlitePath, { throwIfNoEntry: false });
  if (!stat) {
    return {
      mode: "compact" as const,
      path: sqlitePath,
      reason: "missing" as const,
      skipped: true as const,
    };
  }
  if (!stat.isFile()) {
    throw new Error(`Omnipolymath state database is not a regular file: ${sqlitePath}`);
  }
  return await withDoctorSqliteMaintenanceLock({
    env,
    operation: "state SQLite compaction",
    protectedPaths: resolveSqliteDatabaseFilePaths(sqlitePath),
    run: (authority) => {
      authority.assertCurrent();
      if (isOmnipolymathStateDatabaseOpen()) {
        throw new Error(
          "The shared Omnipolymath state database is already open in this process. Stop Omnipolymath and retry.",
        );
      }

      const compact = compactDoctorSqliteFile({
        afterSuccess: () => {
          if (!clearOmnipolymathDatabaseQuarantine(sqlitePath, { env })) {
            throw new Error(
              `Omnipolymath state database ${sqlitePath} was compacted, but its persisted quarantine record could not be cleared. Rerun omnipolymath doctor --fix so the database is not refused again.`,
            );
          }
          clearOmnipolymathStateDatabaseOpenFailure(sqlitePath);
          ensureOmnipolymathStatePermissions(sqlitePath, env);
        },
        sqlitePath,
        validateBeforeMutation: (database) => {
          authority.assertCurrent();
          assertOmnipolymathStateWriteAllowed({ database, databasePath: sqlitePath, env });
          assertOmnipolymathStateDatabaseForMaintenance(database, { pathname: sqlitePath });
        },
      });
      return {
        ...compact,
        mode: "compact" as const,
        path: sqlitePath,
        skipped: false as const,
      };
    },
  });
}
