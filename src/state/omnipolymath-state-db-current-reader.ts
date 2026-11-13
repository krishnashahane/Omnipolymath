import { isPromiseLike } from "@omnipolymath/normalization-core/promise-like";
import { requireNativeDatabaseFile } from "../infra/database-engine/physical-facts.js";
import { isPostgresSqlConnection } from "../infra/sql-connection.js";
import {
  SqliteCoordinatorError,
  throwSqliteLifecycleErrors,
} from "../infra/sqlite-lifecycle-errors.js";
import { runSqliteReadOperationSync } from "../infra/sqlite-schema-facts.js";
import { assertTransactionUsable, runSqliteReadSnapshotSync } from "../infra/sqlite-transaction.js";
import { assertExistingDatabaseIdentity } from "../infra/sqlite-worker-identity.js";
import { hasUpdateDoctorMigrationCapture } from "../infra/update-doctor-migration-attribution.js";
import {
  getOmnipolymathDatabaseMaintenanceResourceScope,
  getOmnipolymathDatabaseMaintenanceScope,
  isStateDatabaseReadAdmissionInvalidatedError,
} from "./omnipolymath-state-db-async-lifecycle.js";
import {
  captureOmnipolymathStateDatabaseReadAdmission,
  omnipolymathStateDatabaseCache,
  registerOmnipolymathStateDatabaseAsyncResource,
  requireOmnipolymathStateDatabaseIdentity,
  retainOmnipolymathStateDatabaseForIndependentRead,
} from "./omnipolymath-state-db-cache.js";
import type {
  OmnipolymathStateDatabaseOptions,
  OmnipolymathStateSchemaReadAdmission,
} from "./omnipolymath-state-db-contract.js";
import { isStatePostgres } from "./omnipolymath-state-db-engine.js";
import {
  assertStateReadSchema,
  openOmnipolymathStateReadConnection,
  type OmnipolymathStateReadConnection,
} from "./omnipolymath-state-db-read-connection.js";
import { canReadWarmNativeSourceIndependently } from "./omnipolymath-state-db-readonly-reuse.js";
import { withCurrentOmnipolymathStateReadScope } from "./omnipolymath-state-db-readonly.js";
import { admitStateSchemaFacts } from "./omnipolymath-state-db-schema-version.js";
import { allowsMaintenanceLiveAuthorityReads } from "./omnipolymath-state-maintenance-context.js";
import type { OmnipolymathStateReadOnlyDatabase } from "./omnipolymath-state-read.types.js";

type CurrentWarmReadResult<T> = { available: false } | { available: true; value: T };

/** Mutating maintenance can retain an independent current reader under its exact source lifetime. */
export function createOmnipolymathStateCurrentWarmReader<T>(
  operation: (database: OmnipolymathStateReadOnlyDatabase) => T,
  options: OmnipolymathStateDatabaseOptions,
  openStateSchemaReadAdmission?: OmnipolymathStateSchemaReadAdmission,
): () => CurrentWarmReadResult<T> {
  let bound:
    | {
        path: string;
        scope: ReturnType<typeof getOmnipolymathDatabaseMaintenanceScope>;
        read(): CurrentWarmReadResult<T>;
      }
    | undefined;
  return () => {
    return withCurrentOmnipolymathStateReadScope(options, (pathname) => {
      const scope = getOmnipolymathDatabaseMaintenanceScope();
      if (!scope?.ownsSchemaMaintenance || (bound && bound.scope !== scope)) {
        return { available: false };
      }
      // Captured SQLite migrations retain native exclusion across commits. An idle
      // independent WAL reader would block that exclusion; use fresh private reads.
      if (!isStatePostgres() && hasUpdateDoctorMigrationCapture()) {
        return { available: false };
      }
      if (isStatePostgres()) {
        requireNativeDatabaseFile("postgres", "repair");
      }
      if (bound && bound.path !== pathname) {
        throw new Error("Current shared-state reader cannot change its database before cleanup");
      }
      if (!bound) {
        const native = omnipolymathStateDatabaseCache.getCachedOmnipolymathStateDatabase(pathname, {
          readOnly: true,
        });
        const liveSource = allowsMaintenanceLiveAuthorityReads(scope, pathname);
        if (!native?.db.isOpen && !liveSource) {
          return { available: false };
        }
        const sourceScope = native && getOmnipolymathDatabaseMaintenanceResourceScope(native.db);
        if (sourceScope && sourceScope !== scope) {
          return { available: false };
        }
        const admission = captureOmnipolymathStateDatabaseReadAdmission(pathname);
        const identity = native ? requireOmnipolymathStateDatabaseIdentity(native) : admission.identity;
        if (
          !identity.key.startsWith("file:") ||
          (native && !canReadWarmNativeSourceIndependently(native, pathname, identity.key))
        ) {
          return { available: false };
        }
        // Doctor's post-backup live source belongs to this scope even without a
        // cached writer; private pre-backup inspection still needs source retention.
        const retained = native
          ? retainOmnipolymathStateDatabaseForIndependentRead(pathname, "cached-read")
          : undefined;
        if (native && !retained) {
          return { available: false };
        }
        let connection: ReturnType<typeof openOmnipolymathStateReadConnection>;
        try {
          connection = openOmnipolymathStateReadConnection(pathname, pathname, identity.key);
        } catch (error) {
          try {
            retained?.release();
          } catch (cleanupError) {
            throwSqliteLifecycleErrors(
              [error, cleanupError],
              "Current shared-state reader open and cleanup failed.",
            );
          }
          throw error;
        }
        let active = true;
        let unregister = () => {};
        const assertCurrent = () => {
          if (!active) {
            throw new Error("Current shared-state reader is closed");
          }
          scope?.assertReadAdmission();
          try {
            admission.assertCurrent();
          } catch (error) {
            if (!isStateDatabaseReadAdmissionInvalidatedError(error)) {
              throw error;
            }
            // Maintenance revoked this generation; the fallback owns fresh admission.
            close();
            return false;
          }
          retained?.assertCurrent();
          assertExistingDatabaseIdentity(pathname, identity.key);
          omnipolymathStateDatabaseCache.assertOmnipolymathStateDatabaseFreshOpenAllowedAtPath(
            pathname,
            options.env ?? process.env,
          );
          return true;
        };
        const close = () => {
          if (!active) {
            return;
          }
          if (!connection.close()) {
            throw new Error("Current shared-state reader cleanup is incomplete");
          }
          retained?.release();
          active = false;
          if (bound === reader) {
            bound = undefined;
          }
          unregister();
        };
        const reader = {
          path: pathname,
          scope,
          read(): CurrentWarmReadResult<T> {
            if (!assertCurrent()) {
              return { available: false };
            }
            const result = runOmnipolymathStateCurrentReadConnection(
              connection,
              operation,
              openStateSchemaReadAdmission,
            );
            retained?.observe();
            return { available: true, value: result };
          },
        };
        const resource = {
          async close(closingIdentity?: { key: string; canonicalPath: string }) {
            if (
              !active ||
              (closingIdentity &&
                closingIdentity.key !== identity.key &&
                closingIdentity.canonicalPath !== identity.canonicalPath)
            ) {
              return;
            }
            close();
          },
        };
        unregister = registerOmnipolymathStateDatabaseAsyncResource(resource);
        scope?.own(resource, "shared-resources", () => resource.close());
        bound = reader;
      }
      return bound.read();
    });
  };
}

/** An independent current reader keeps composite policy rows in one bounded snapshot. */
function runOmnipolymathStateCurrentReadConnection<T>(
  connection: OmnipolymathStateReadConnection,
  operation: (database: OmnipolymathStateReadOnlyDatabase) => T,
  openStateSchemaReadAdmission?: OmnipolymathStateSchemaReadAdmission,
): T {
  const { db, path: pathname } = connection.database;
  let closeAdmission: (() => void) | undefined;
  const errors: unknown[] = [];
  let result!: T;
  try {
    if (isPostgresSqlConnection(db)) {
      requireNativeDatabaseFile("postgres", "repair");
    }
    // Explicit Doctor inspection retains its checks; ordinary runtime reads have no callback.
    closeAdmission = openStateSchemaReadAdmission?.(db);
    const context = openStateSchemaReadAdmission ? "doctor-maintenance" : "runtime";
    runSqliteReadOperationSync(db, () => {
      // The schema owner already retains validation for this physical database.
      admitStateSchemaFacts(db, pathname, context);
      assertStateReadSchema(db, pathname, undefined, context);
    });
    result = runSqliteReadSnapshotSync(db, () => {
      const value = operation(connection.database);
      if (isPromiseLike(value)) {
        throw new SqliteCoordinatorError("SQLite current-authority read must remain synchronous");
      }
      return value;
    });
  } catch (error) {
    errors.push(error);
  }
  try {
    closeAdmission?.();
  } catch (error) {
    errors.push(error);
  }
  try {
    assertTransactionUsable(db);
  } catch (error) {
    errors.push(error);
  }
  throwSqliteLifecycleErrors(errors, "Current shared-state read and schema cleanup failed.");
  return result;
}
