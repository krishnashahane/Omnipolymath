import path from "node:path";
import { isMainThread } from "node:worker_threads";
import { isAbortError } from "../infra/abort-signal.js";
import { isPostgresSqlConnection } from "../infra/sql-connection.js";
import type { SqliteWalHealth } from "../infra/sqlite-wal-checkpoint.js";
import {
  registerSqliteWalWorkerMaintenance,
  type SqliteWalPeriodicRequest,
  type SqliteWalPeriodicResult,
} from "../infra/sqlite-wal-write-admission.js";
import type { DatabasePathIdentity } from "../infra/sqlite-worker-identity.js";
import { createSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import {
  getOmnipolymathDatabaseMaintenanceResourceScope,
  isStateDatabaseReadAdmissionInvalidatedError,
  StateDatabaseReadAdmissionInvalidatedError,
  type OmnipolymathStateDatabaseReadAdmission,
} from "./omnipolymath-state-db-async-lifecycle.js";
import type { StateDatabaseLifecycle } from "./omnipolymath-state-db-cache.types.js";
import type { OmnipolymathStateDatabase } from "./omnipolymath-state-db-contract.js";
import { resolveOmnipolymathStateSqlitePath } from "./omnipolymath-state-db.paths.js";
import { captureOmnipolymathStateWorkerContextWithAdmission } from "./omnipolymath-state-worker-context.capture.js";

/** Bind periodic maintenance and its observations to the cache's exact native owner. */
export function createStateDatabaseWalOwner(
  {
    cachedDatabases,
    retainedDatabaseHandles,
    databaseIdentities,
    asyncResources,
  }: StateDatabaseLifecycle,
  retainForIdle: (database: OmnipolymathStateDatabase) => () => void,
  requireIdentity: (database: OmnipolymathStateDatabase) => DatabasePathIdentity,
) {
  return {
    ownRetirement(this: void, database: OmnipolymathStateDatabase, close: () => Promise<void>) {
      const identity = requireIdentity(database);
      const resource = {
        admission: { identity },
        close,
      };
      const unregister = asyncResources.register(resource);
      getOmnipolymathDatabaseMaintenanceResourceScope(database.db)?.own(
        resource,
        "shared-references",
        () => resource.close(),
      );
      return unregister;
    },
    async stop(this: void, pathname?: string, identity?: DatabasePathIdentity): Promise<void> {
      const databases = new Set([...retainedDatabaseHandles.values(), ...cachedDatabases.values()]);
      await Promise.all(
        [...databases]
          .filter(
            (database) =>
              pathname === undefined ||
              database.path === pathname ||
              (identity !== undefined && databaseIdentities.get(database.db)?.key === identity.key),
          )
          .flatMap(({ walMaintenance }) => (walMaintenance ? [walMaintenance.stop()] : [])),
      );
    },
    register(
      this: void,
      database: OmnipolymathStateDatabase,
      identity: DatabasePathIdentity,
      admission: OmnipolymathStateDatabaseReadAdmission,
      env: NodeJS.ProcessEnv,
    ): void {
      if (!isMainThread || isPostgresSqlConnection(database.db)) {
        return;
      }
      const capturedContext = captureOmnipolymathStateWorkerContextWithAdmission(
        { path: database.path, env },
        () => admission,
        asyncResources.knownIdentity,
      );
      const controller = new AbortController();
      let pending: Promise<SqliteWalPeriodicResult | undefined> | undefined;
      const cancel = () => {
        controller.abort();
        if (!pending) {
          unregister();
          return undefined;
        }
        return pending.then(
          () => undefined,
          () => undefined,
        );
      };
      const resource = {
        admission: { identity },
        async close() {
          void cancel();
          // The broker retains native cleanup; this owner joins accepted work before retirement.
          await database.walMaintenance.stop();
          unregister();
        },
      };
      const unregister = asyncResources.register(resource);
      const run = async (request: SqliteWalPeriodicRequest) => {
        const maintenanceScope = getOmnipolymathDatabaseMaintenanceResourceScope(database.db);
        const context = { ...capturedContext, maintenanceScope };
        const assertCurrent = () => {
          controller.signal.throwIfAborted();
          context.admission.assertCurrent();
          maintenanceScope?.assertAdmission();
          if (
            getOmnipolymathDatabaseMaintenanceResourceScope(database.db) !== maintenanceScope ||
            cachedDatabases.get(database.path) !== database ||
            !database.db.isOpen
          ) {
            throw new StateDatabaseReadAdmissionInvalidatedError(
              "Shared-state WAL maintenance owner changed",
            );
          }
        };
        let releaseIdle: (() => void) | undefined;
        let operationStarted = false;
        try {
          assertCurrent();
          releaseIdle = retainForIdle(database);
          const { runOmnipolymathStateWorkerOperation } =
            await import("./omnipolymath-state-worker-store.js");
          assertCurrent();
          return await runOmnipolymathStateWorkerOperation(
            context,
            (worker) =>
              worker.execute(
                { type: "database.walMaintenance", input: request },
                { signal: controller.signal },
              ),
            {
              existingOnly: true,
              assertCurrent,
              createAdmission: () => ({
                nativeLocations: [database.path, identity.canonicalPath],
                databaseIdentity: {
                  databasePath: database.path,
                  key: identity.key,
                  birthtime: identity.birthtime,
                },
                admission: createSqliteWorkerOperationAdmission((_request, grant) => {
                  assertCurrent();
                  if (!grant()) {
                    throw new StateDatabaseReadAdmissionInvalidatedError(
                      "Shared-state WAL maintenance authority expired",
                    );
                  }
                  operationStarted = true;
                }),
              }),
            },
          );
        } catch (error) {
          if (
            !operationStarted &&
            (isStateDatabaseReadAdmissionInvalidatedError(error) ||
              (controller.signal.aborted && isAbortError(error)))
          ) {
            return undefined;
          }
          throw error;
        } finally {
          releaseIdle?.();
        }
      };
      registerSqliteWalWorkerMaintenance(
        database.db,
        (operation) => {
          if (controller.signal.aborted) {
            return Promise.resolve(undefined);
          }
          const active = run(operation);
          pending = active;
          return active.finally(() => {
            if (pending === active) {
              pending = undefined;
            }
            if (controller.signal.aborted) {
              unregister();
            }
          });
        },
        cancel,
      );
    },
    /** Report the last observation without opening or querying SQLite. */
    readHealth(this: void): SqliteWalHealth | undefined {
      const database = cachedDatabases.get(path.resolve(resolveOmnipolymathStateSqlitePath()));
      return database?.db.isOpen ? database.walMaintenance.health : undefined;
    },
  };
}
