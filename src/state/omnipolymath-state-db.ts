import { existsSync } from "node:fs";
import { withEngineStoreAdmission } from "../infra/database-engine/admission-scope.js";
import { requireNativeDatabaseFile } from "../infra/database-engine/physical-facts.js";
import {
  assertStateDatabaseAccessAllowed,
  withStateDatabaseColdAdmission,
} from "../infra/gateway-state-owner.js";
import type { EngineConnection } from "../infra/sql-connection.js";
import { isPostgresSqlConnection } from "../infra/sql-connection.js";
import {
  normalizeSqliteNonNegativeInteger,
  runWithSqliteBusyTimeout,
  setSqliteBusyTimeout,
  type SqliteLockFailureReporting,
} from "../infra/sqlite-busy-timeout.js";
import { assertSqliteIntegrity } from "../infra/sqlite-integrity.js";
import { createSqliteLifecycleAggregateError } from "../infra/sqlite-lifecycle-errors.js";
import { captureSqliteReaderOwner } from "../infra/sqlite-reader-lifecycle.js";
import { resolveSqliteInspectionSignal } from "../infra/sqlite-readonly-worker.js";
import {
  getAdmittedSqliteSchemaFacts,
  invalidateSqliteSchemaFacts,
} from "../infra/sqlite-schema-facts.js";
import {
  openSqliteReadOnlyDatabase,
  prepareArtifactPreservingSqliteRead,
  prepareSqliteReadOnlyLocation,
} from "../infra/sqlite-snapshot-source.js";
import {
  assertTransactionUsable,
  type SqliteTransactionOptions,
} from "../infra/sqlite-transaction.js";
import {
  StateSchemaMutationConflictError,
  withStateDatabaseSchemaMaintenance,
  withStateDatabaseSchemaMaintenanceAsync,
} from "../infra/state-database-maintenance.js";
import { getAsyncWorkSignal } from "../shared/async-work-scope.js";
import { isArtifactPreservingStateRead } from "./artifact-preserving-state-reads.js";
import {
  getStateSchemaVersionAdmission,
  readPublishedStateSchemaVersion,
} from "./omnipolymath-state-db-admission.js";
import {
  getOmnipolymathDatabaseMaintenanceScope,
  observeOmnipolymathDatabaseMaintenanceResource,
} from "./omnipolymath-state-db-async-lifecycle.js";
import {
  closeOmnipolymathStateDatabaseByPathAsync,
  omnipolymathStateDatabaseCache as stateDbCache,
  recordOmnipolymathStateDatabaseOpenFailure,
} from "./omnipolymath-state-db-cache.js";
import {
  OMNIPOLYMATH_DATABASE_SCHEMA_DOCS_URL,
  OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS,
  OMNIPOLYMATH_STATE_SCHEMA_VERSION,
  type OmnipolymathStateDatabase,
  type OmnipolymathStateDatabaseOptions,
} from "./omnipolymath-state-db-contract.js";
import { openDoctorStateSchemaReadAdmission } from "./omnipolymath-state-db-doctor-schema.js";
import { assertStateFileSnapshotAllowed, isStatePostgres } from "./omnipolymath-state-db-engine.js";
import {
  assertExistingOmnipolymathStateRuntimeSchema,
  assertStateDatabaseSchemaAdmission,
} from "./omnipolymath-state-db-existing-schema.js";
import { needsOmnipolymathStateDatabaseSchemaRepair } from "./omnipolymath-state-db-fast-path.js";
import {
  assertOmnipolymathStateDatabaseForMaintenance,
  markCurrentStateSchemaVersion,
} from "./omnipolymath-state-db-maintenance.js";
import {
  openUnpublishedStateDatabase,
  openUnpublishedStateDatabaseAsync,
  runStateOpenSteps,
  runStateOpenStepsAsync,
} from "./omnipolymath-state-db-open.js";
import { ensureOmnipolymathStatePermissions } from "./omnipolymath-state-db-permissions.js";
import {
  openOmnipolymathStateReadConnection,
  readOnlyStateDatabase,
} from "./omnipolymath-state-db-read-connection.js";
import { withExistingOmnipolymathStateDatabaseReadOnly } from "./omnipolymath-state-db-readonly.js";
import {
  repairStateSchema,
  repairStateSchemaAsync,
  repairDoctorStateSchema,
  repairDoctorStateSchemaAsync,
} from "./omnipolymath-state-db-repair.js";
import {
  assertOmnipolymathStateSchemaRepairAllowed,
  isExistingOmnipolymathStateSchema,
  recordExistingOmnipolymathStateSchemaDatabase,
} from "./omnipolymath-state-db-schema-policy.js";
import { ensureOmnipolymathStateRuntimeSchema as ensureSchema } from "./omnipolymath-state-db-schema-runtime.js";
import {
  assertSupportedStateSchemaVersion,
  readStateSchemaContentVersion,
} from "./omnipolymath-state-db-schema-version.js";
import {
  initializeNativeOmnipolymathStateConnection,
  withOmnipolymathStateStartupCheckpointConnection,
} from "./omnipolymath-state-db-startup-checkpoint.js";
import { runManagedStateTransaction } from "./omnipolymath-state-db-transaction.js";
import { resolveDatabasePath } from "./omnipolymath-state-db.paths.js";
import { assertOmnipolymathStateWriteAllowedAtPath } from "./omnipolymath-state-ownership-preflight.js";
import {
  assertOmnipolymathStateWriteAllowed,
  isOmnipolymathStateWriteContentionError,
} from "./omnipolymath-state-ownership.js";
import {
  readStateSchemaPublicationBlocker,
  type StateSchemaPublicationBlocker,
} from "./omnipolymath-state-schema-publication.js";

export { registerOmnipolymathStateDatabaseLifecycleListener } from "./omnipolymath-state-db-cache.js";

export { OMNIPOLYMATH_DATABASE_SCHEMA_DOCS_URL, OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS };
export type {
  OmnipolymathStateDatabase,
  OmnipolymathStateDatabaseOptions,
  OmnipolymathStateDatabaseSchemaMigration,
} from "./omnipolymath-state-db-contract.js";
export { assertOmnipolymathStateDatabaseForMaintenance } from "./omnipolymath-state-db-maintenance.js";
export { ensureOmnipolymathStatePermissions } from "./omnipolymath-state-db-permissions.js";
export { detectOmnipolymathStateDatabaseSchemaMigrations } from "./omnipolymath-state-db-schema-discovery.js";

const deferredStateDatabases = new WeakSet<EngineConnection>();

type StateSchemaRepairResult = { changes: string[]; warnings: string[]; failure?: unknown };

export function repairOmnipolymathStateDatabaseSchema(
  options: OmnipolymathStateDatabaseOptions & {
    versionMigrationOnly?: boolean;
    integrityCheck?: "quick" | "full";
  } = {},
): StateSchemaRepairResult {
  if (isStatePostgres()) {
    openOmnipolymathStateDatabase(options);
    return { changes: [], warnings: [] };
  }
  return repairDoctorStateSchema(options, options.versionMigrationOnly ? "version" : "doctor");
}

/** Explicit Doctor maintenance before config readers encounter a quarantined index. */
export async function repairOmnipolymathStateDatabaseIndexesForDoctor(
  options: OmnipolymathStateDatabaseOptions & { integrityCheck?: "quick" | "full" } = {},
): Promise<StateSchemaRepairResult> {
  if (isStatePostgres()) {
    await openOmnipolymathStateDatabaseForDoctor(options);
    return { changes: [], warnings: [] };
  }
  return repairDoctorStateSchemaAsync(
    { ...options, integrityCheck: options.integrityCheck ?? "full" },
    "indexes",
  );
}

/** Repair known catalog damage and preserve orphan rows before Doctor backs up or loads state. */
export async function repairOmnipolymathStateDatabaseReadabilityForDoctor(
  options: OmnipolymathStateDatabaseOptions & { integrityCheck?: "quick" | "full" } = {},
): Promise<StateSchemaRepairResult> {
  if (isStatePostgres()) {
    await openOmnipolymathStateDatabaseForDoctor(options);
    return { changes: [], warnings: [] };
  }
  return repairDoctorStateSchemaAsync(options, "readability");
}

/** Prepare schema and retire resources only when the admitted operation actually repairs it. */
export async function prepareOmnipolymathStateDatabaseSchema(
  options: OmnipolymathStateDatabaseOptions & {
    integrityCheck?: "quick" | "full";
    legacyCronDefaultStoreKey?: string;
  } = {},
  mode: "automatic" | "doctor-preparation" | "doctor" = "automatic",
): Promise<StateSchemaRepairResult> {
  if (isStatePostgres()) {
    await openOmnipolymathStateDatabaseForDoctor(options);
    return { changes: [], warnings: [] };
  }
  const env = options.env ?? process.env;
  const pathname = resolveDatabasePath(options);
  assertOmnipolymathStateSchemaRepairAllowed(pathname);
  if (!existsSync(pathname)) {
    return { changes: [], warnings: [] };
  }

  const scope = mode === "automatic" ? "automatic" : "doctor";
  await assertOmnipolymathStateWriteAllowedAtPath({
    databasePath: pathname,
    env,
    recoverOrphanedSidecars: false,
    ...(scope === "doctor"
      ? { openStateSchemaReadAdmission: openDoctorStateSchemaReadAdmission }
      : {}),
  });
  let repairStarted = false;
  try {
    let needsRepair = mode === "doctor";
    if (mode === "doctor-preparation") {
      try {
        stateDbCache.assertOmnipolymathStateDatabaseFreshOpenAllowedAtPath(pathname, env);
      } catch {
        // The full repair must clear quarantine before dependent readers can proceed.
        needsRepair = true;
      }
    }
    if (
      !needsRepair &&
      !(await needsOmnipolymathStateDatabaseSchemaRepair(pathname, scope, options.integrityCheck))
    ) {
      return { changes: [], warnings: [] };
    }
    repairStarted = true;
    // Retire prior writers and publish their native-close receipts before the
    // private repair handle validates its source and acquires exclusive custody.
    await closeOmnipolymathStateDatabaseByPathAsync(pathname);
    const repairArgs: Parameters<typeof repairStateSchema> = [
      pathname,
      env,
      scope,
      options.integrityCheck,
      options.legacyCronDefaultStoreKey,
    ];
    return scope === "automatic"
      ? withStateDatabaseSchemaMaintenance({ databasePath: pathname }, () =>
          repairStateSchema(...repairArgs),
        )
      : await withStateDatabaseSchemaMaintenanceAsync({ databasePath: pathname }, () =>
          repairStateSchemaAsync(...repairArgs),
        );
  } finally {
    // Readiness checks borrow the live generation; only admitted repair retires it.
    if (repairStarted) {
      await closeOmnipolymathStateDatabaseByPathAsync(pathname);
    }
  }
}

/** Bootstrap fresh/native-only state canonically before startup checkpoint access. */
export function withOmnipolymathStateStartupMigrationCheckpointDatabase<T>(
  callback: (db: EngineConnection) => T,
  options: OmnipolymathStateDatabaseOptions & {
    atomic?: boolean;
    sealOnClose?: boolean;
    singleStatement?: true;
  } = {},
): T {
  assertOmnipolymathStateSchemaRepairAllowed(resolveDatabasePath(options));
  if (isStatePostgres()) {
    return withEngineStoreAdmission(() => {
      const database = openOmnipolymathStateDatabase(options);
      try {
        return runOmnipolymathStateWriteTransaction(({ db }) => callback(db), { ...options, database });
      } finally {
        if (options.sealOnClose) {
          stateDbCache.closeOmnipolymathStateDatabaseByPath(database.path);
        }
      }
    });
  }
  const database = getOmnipolymathStateDatabaseIfOpen(options);
  if (database && isPostgresSqlConnection(database.db)) {
    requireNativeDatabaseFile("postgres", "repair");
  }
  if (
    database &&
    getAdmittedSqliteSchemaFacts(database.db)?.userVersion === OMNIPOLYMATH_STATE_SCHEMA_VERSION
  ) {
    // Lease rows use the admitted owner; legacy/native bootstrap still needs its
    // separate integrity-proven connection before the full schema can be opened.
    const result = runOmnipolymathStateWriteTransaction(
      ({ db }) => {
        if (isPostgresSqlConnection(db)) {
          requireNativeDatabaseFile("postgres", "repair");
        }
        return callback(db);
      },
      { env: options.env, path: database.path },
      {
        operationLabel: "state.startup-checkpoint.write",
        singleStatement: options.singleStatement,
      },
    );
    if (options.sealOnClose) {
      stateDbCache.closeOmnipolymathStateDatabaseByPath(database.path);
    }
    return result;
  }
  return withOmnipolymathStateStartupCheckpointConnection(callback, options, ensureSchema);
}

/** Complete native bootstrap without migrating mature shared state. */
export function initializeNativeOmnipolymathStateDatabase(
  options: OmnipolymathStateDatabaseOptions = {},
): void {
  if (isStatePostgres()) {
    requireNativeDatabaseFile("postgres", "repair");
  }
  initializeNativeOmnipolymathStateConnection(options, (db, pathname, env, initialization) =>
    ensureSchema(db, pathname, env, initialization, OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS, true),
  );
}

/** Open existing shared state without creating, migrating, chmodding, or configuring it. */
export async function openExistingOmnipolymathStateDatabaseReadOnly(
  options: OmnipolymathStateDatabaseOptions & {
    requireCanonicalSchema?: boolean;
    integrityCheck?: "quick" | "full";
  } = {},
): Promise<OmnipolymathStateDatabase | undefined> {
  const pathname = resolveDatabasePath(options);
  isExistingOmnipolymathStateSchema(pathname);
  if (!existsSync(pathname)) {
    return undefined;
  }
  stateDbCache.assertOmnipolymathStateDatabaseFreshOpenAllowedAtPath(
    pathname,
    options.env ?? process.env,
  );
  const prepared = isStatePostgres() ? pathname : await prepareSqliteReadOnlyLocation(pathname);
  const connection = openOmnipolymathStateReadConnection(pathname, prepared);
  const { db } = connection.database;
  try {
    if (isPostgresSqlConnection(db)) {
      assertSupportedStateSchemaVersion(db, pathname);
    } else if (isExistingOmnipolymathStateSchema(pathname, db) || options.requireCanonicalSchema) {
      assertExistingOmnipolymathStateRuntimeSchema(db, pathname);
    } else {
      assertSupportedStateSchemaVersion(db, pathname);
      assertSqliteIntegrity(db, pathname, { check: options.integrityCheck });
      if (readStateSchemaContentVersion(db) === OMNIPOLYMATH_STATE_SCHEMA_VERSION) {
        assertOmnipolymathStateDatabaseForMaintenance(db, { pathname });
      }
    }
  } catch (error) {
    try {
      connection.close();
    } catch {
      // Preserve the verification failure that explains why the database was refused.
    }
    throw error;
  }
  return readOnlyStateDatabase(connection.database, connection.close);
}

type StateDatabaseOpenStep = {
  run(): OmnipolymathStateDatabase;
  runAsync(): Promise<OmnipolymathStateDatabase>;
};

function openOmnipolymathStateDatabaseWithBusyTimeout(
  ...args: Parameters<typeof openStateDatabaseSteps>
): OmnipolymathStateDatabase {
  return runStateOpenSteps(openStateDatabaseSteps(...args));
}

type DoctorStateDatabaseOpenOptions = OmnipolymathStateDatabaseOptions & {
  clientCredentialMigrationFromVersion?: number;
};

/** Await initial capture before publishing the ordinary cached Doctor writer. */
export async function openOmnipolymathStateDatabaseForDoctor(
  options: DoctorStateDatabaseOpenOptions = {},
): Promise<OmnipolymathStateDatabase> {
  const signal = resolveSqliteInspectionSignal(getAsyncWorkSignal());
  await prepareArtifactPreservingSqliteRead(
    options.database?.path ?? resolveDatabasePath(options),
    signal,
  );
  return runStateOpenStepsAsync(openStateDatabaseSteps(options));
}

function* openStateDatabaseSteps(
  options: DoctorStateDatabaseOpenOptions = {},
  busyTimeoutMs = OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS,
  lockFailureReporting: SqliteLockFailureReporting = "report",
  remainingColdAdmissionTimeout?: () => number,
): Generator<StateDatabaseOpenStep, OmnipolymathStateDatabase, OmnipolymathStateDatabase> {
  getOmnipolymathDatabaseMaintenanceScope()?.assertAdmission();
  const env = options.env ?? process.env;
  const pathname = options.database?.path ?? resolveDatabasePath(options);
  if (isArtifactPreservingStateRead("agent", pathname)) {
    assertStateFileSnapshotAllowed();
    stateDbCache.assertOmnipolymathStateDatabaseFreshOpenAllowedAtPath(pathname, env);
    const db = openSqliteReadOnlyDatabase(pathname, { timeout: busyTimeoutMs });
    assertSupportedStateSchemaVersion(db, pathname);
    return readOnlyStateDatabase({ db, path: pathname }, () => {
      db.close();
      return true;
    });
  }
  const existingSchema = !options.database && isExistingOmnipolymathStateSchema(pathname);
  const cached = options.database ?? stateDbCache.getCachedOmnipolymathStateDatabase(pathname);
  if (cached && (options.database || cached.db.isOpen)) {
    if (!options.database) {
      // A refused cache borrow did not open or damage the database. Failure owners
      // publish their own retirement events; caller admission must not retire it.
      stateDbCache.assertOmnipolymathStateDatabaseOpenAllowed(pathname);
    }
    assertStateDatabaseSchemaAdmission(cached);
    assertOmnipolymathStateWriteAllowed({
      database: cached.db,
      databasePath: pathname,
      env,
      schemaReady: stateDbCache.isOmnipolymathStateDatabaseSchemaReady(cached),
    });
    observeOmnipolymathDatabaseMaintenanceResource(cached.db);
    if (options.database) {
      stateDbCache.touchStateDatabase(cached);
    } else if (!existingSchema && deferredStateDatabases.has(cached.db)) {
      reconcileOmnipolymathStateSchemaPublication(options);
      if (
        getStateSchemaVersionAdmission(cached.db)?.userVersion === OMNIPOLYMATH_STATE_SCHEMA_VERSION
      ) {
        deferredStateDatabases.delete(cached.db);
      }
    }
    return cached;
  }
  let unpublished: OmnipolymathStateDatabase | undefined;
  try {
    const open = <T>(
      remaining: () => number,
      acquire: (params: Parameters<typeof openUnpublishedStateDatabase>[0]) => T,
    ) => {
      getOmnipolymathDatabaseMaintenanceScope()?.assertAdmission();
      stateDbCache.assertOmnipolymathStateDatabaseOpenAllowed(pathname);
      stateDbCache.assertOmnipolymathStateDatabaseFreshOpenAllowedAtPath(pathname, env);
      if (cached) {
        // A closed handle can leave Kysely and WAL helpers cached.
        stateDbCache.closeStaleCachedOmnipolymathStateDatabase(cached);
      }
      return acquire({
        pathname,
        env,
        busyTimeoutMs: remaining(),
        lockFailureReporting,
        existingSchema,
        initializationAgentPaths: options.initializationAgentPaths,
        clientCredentialMigrationFromVersion: options.clientCredentialMigrationFromVersion,
        ensureSchema: (database, initialization, credentialCustody) =>
          ensureSchema(
            database,
            pathname,
            env,
            initialization,
            remaining(),
            false,
            undefined,
            credentialCustody,
          ),
        recordOpenFailure: recordOmnipolymathStateDatabaseOpenFailure,
      });
    };
    const acquire = <T>(read: (params: Parameters<typeof openUnpublishedStateDatabase>[0]) => T) =>
      remainingColdAdmissionTimeout
        ? open(remainingColdAdmissionTimeout, read)
        : withStateDatabaseColdAdmission({ databasePath: pathname, busyTimeoutMs }, (remaining) =>
            open(remaining, read),
          );
    unpublished = yield {
      run() {
        return acquire(openUnpublishedStateDatabase);
      },
      runAsync() {
        return acquire(openUnpublishedStateDatabaseAsync);
      },
    };
    resolveSqliteInspectionSignal(getAsyncWorkSignal())?.throwIfAborted();
    getOmnipolymathDatabaseMaintenanceScope()?.assertAdmission();
    if (!isPostgresSqlConnection(unpublished.db)) {
      setSqliteBusyTimeout(unpublished.db, busyTimeoutMs);
    }
  } catch (error) {
    if (lockFailureReporting === "report" || !isOmnipolymathStateWriteContentionError(error)) {
      stateDbCache.recordOmnipolymathStateDatabaseLifecycleOpenError(pathname, error);
    }
    if (unpublished) {
      const errors = stateDbCache.closeUnpublishedOmnipolymathStateDatabaseHandle(unpublished);
      if (errors.length > 0) {
        throw createSqliteLifecycleAggregateError(
          [error, ...errors],
          `Fresh Omnipolymath state database open failed releasing access and closing its unpublished handle for ${pathname}.`,
          error,
        );
      }
    }
    throw error;
  }
  if (existingSchema) {
    recordExistingOmnipolymathStateSchemaDatabase(unpublished.db, pathname);
  }
  const database = stateDbCache.publishOmnipolymathStateDatabase(unpublished, env);
  try {
    if (
      !existingSchema &&
      readPublishedStateSchemaVersion(database.db) < OMNIPOLYMATH_STATE_SCHEMA_VERSION
    ) {
      deferredStateDatabases.add(database.db);
      reconcileOmnipolymathStateSchemaPublication(options);
    }
    return database;
  } catch (error) {
    // Failed publication can retain this cached handle before the caller can
    // restore its temporary busy timeout. Ordinary later writes keep their policy.
    if (database.db.isOpen && !isPostgresSqlConnection(database.db)) {
      setSqliteBusyTimeout(database.db, OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS);
    }
    throw error;
  }
}

export function openOmnipolymathStateDatabase(
  options: OmnipolymathStateDatabaseOptions = {},
): OmnipolymathStateDatabase {
  return openOmnipolymathStateDatabaseWithBusyTimeout(options);
}

/** The Gateway watcher also publishes without requiring a new physical database open. */
export function reconcileOmnipolymathStateSchemaPublication(
  options: OmnipolymathStateDatabaseOptions = {},
): StateSchemaPublicationBlocker | undefined {
  if (isExistingOmnipolymathStateSchema(options.database?.path ?? resolveDatabasePath(options))) {
    return undefined;
  }
  const pending = withExistingOmnipolymathStateDatabaseReadOnly(({ db }) => {
    if (
      readPublishedStateSchemaVersion(db) >= OMNIPOLYMATH_STATE_SCHEMA_VERSION ||
      readStateSchemaContentVersion(db) < OMNIPOLYMATH_STATE_SCHEMA_VERSION
    ) {
      return undefined;
    }
    if (isPostgresSqlConnection(db)) {
      requireNativeDatabaseFile("postgres", "repair");
    }
    return { blocker: readStateSchemaPublicationBlocker(db) };
  }, options);
  if (!pending || pending.blocker) {
    return pending?.blocker;
  }
  const pathname = resolveDatabasePath(options);
  try {
    return withStateDatabaseSchemaMaintenance({ databasePath: pathname }, () =>
      runOmnipolymathStateWriteTransaction(
        ({ db }) => {
          if (isPostgresSqlConnection(db)) {
            requireNativeDatabaseFile("postgres", "repair");
          }
          // The advisory read may race a new update. Re-read every driver under the write lock.
          const blocker = readStateSchemaPublicationBlocker(db);
          if (blocker) {
            return blocker;
          }
          assertOmnipolymathStateDatabaseForMaintenance(db, { pathname });
          markCurrentStateSchemaVersion(db);
          return undefined;
        },
        options,
        { operationLabel: "state.schema.publish" },
      ),
    );
  } catch (error) {
    // Current content is ready for readers; a live Gateway owns optional publication.
    if (error instanceof StateSchemaMutationConflictError) {
      return undefined;
    }
    throw error;
  }
}

/** Run one operation through the shared owner without waiting synchronously on SQLite locks. */
export function runWithOmnipolymathStateBusyTimeout<T>(
  operation: (database: OmnipolymathStateDatabase) => T,
  options: OmnipolymathStateDatabaseOptions,
  busyTimeoutMs: number,
): T {
  if (
    isArtifactPreservingStateRead("agent", options.database?.path ?? resolveDatabasePath(options))
  ) {
    return operation(openOmnipolymathStateDatabaseWithBusyTimeout(options, busyTimeoutMs));
  }
  getOmnipolymathDatabaseMaintenanceScope()?.assertAdmission();
  const normalizedTimeoutMs = normalizeSqliteNonNegativeInteger(busyTimeoutMs, "busyTimeoutMs");
  const existing = options.database ?? getOmnipolymathStateDatabaseIfOpen(options);
  if (existing) {
    assertStateDatabaseSchemaAdmission(existing);
    const execute = () => {
      observeOmnipolymathDatabaseMaintenanceResource(existing.db);
      stateDbCache.touchStateDatabase(existing);
      return operation(existing);
    };
    if (isPostgresSqlConnection(existing.db)) {
      return execute();
    }
    return runWithSqliteBusyTimeout(existing.db, normalizedTimeoutMs, execute, {
      lockFailureReporting: "suppress",
    });
  }
  const opened = openOmnipolymathStateDatabaseWithBusyTimeout(options, normalizedTimeoutMs, "suppress");
  try {
    if (isPostgresSqlConnection(opened.db)) {
      return operation(opened);
    }
    return runWithSqliteBusyTimeout(opened.db, normalizedTimeoutMs, () => operation(opened), {
      lockFailureReporting: "suppress",
    });
  } finally {
    if (opened.db.isOpen && !isPostgresSqlConnection(opened.db)) {
      setSqliteBusyTimeout(opened.db, OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS);
    }
  }
}

/** Run an admitted shared-state write; complete single statements may use autocommit. */
export function runOmnipolymathStateWriteTransaction<T>(
  operation: (database: OmnipolymathStateDatabase) => T,
  options: OmnipolymathStateDatabaseOptions = {},
  transactionOptions: Pick<
    SqliteTransactionOptions,
    "beginLockFailureReporting" | "busyTimeoutMs" | "operationLabel" | "slowTransactionHoldMs"
  > & { singleStatement?: true } = {},
): T {
  if (
    isArtifactPreservingStateRead("agent", options.database?.path ?? resolveDatabasePath(options))
  ) {
    throw new Error("Programming error: shared-state write during artifact-preserving inspection.");
  }
  getOmnipolymathDatabaseMaintenanceScope()?.assertAdmission();
  const existing = options.database ?? getOmnipolymathStateDatabaseIfOpen(options);
  if (existing) {
    isExistingOmnipolymathStateSchema(existing.path, existing.db);
    if (options.database) {
      assertStateDatabaseAccessAllowed(existing.path);
    }
  }
  let database = existing;
  let callbackEntered = false;
  let committed: { database: OmnipolymathStateDatabase; value: T };
  const execute = (remaining?: () => number) => {
    // A supplied writer is already selected; its authoritative rows are read after BEGIN.
    const acquired =
      database ??
      openOmnipolymathStateDatabaseWithBusyTimeout(
        options,
        OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS,
        "report",
        remaining,
      );
    database = acquired;
    const value = runManagedStateTransaction(
      acquired.db,
      () => {
        assertStateDatabaseSchemaAdmission(acquired);
        // Recheck cached-path admission after a cold-open contention retry.
        if (!options.database) {
          getOmnipolymathStateDatabaseIfOpen(options);
        }
        assertOmnipolymathStateWriteAllowed({
          database: acquired.db,
          databasePath: acquired.path,
          env: options.env ?? process.env,
          schemaReady: stateDbCache.isOmnipolymathStateDatabaseSchemaReady(acquired),
        });
        observeOmnipolymathDatabaseMaintenanceResource(acquired.db);
        if (options.database) {
          stateDbCache.touchStateDatabase(acquired);
        }
        callbackEntered = true;
        return operation(acquired);
      },
      {
        databaseLabel: acquired.path,
        ...transactionOptions,
        ...(remaining ? { busyTimeoutMs: remaining() } : {}),
        operationLabel:
          transactionOptions.operationLabel ??
          captureSqliteReaderOwner()?.operation ??
          "state.write",
      },
    );
    return { database: acquired, value };
  };
  try {
    committed = existing
      ? execute()
      : withStateDatabaseColdAdmission(
          {
            databasePath: resolveDatabasePath(options),
            busyTimeoutMs: transactionOptions.busyTimeoutMs ?? OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS,
            canRetry() {
              if (
                callbackEntered ||
                (database && (!database.db.isOpen || database.db.isTransaction))
              ) {
                return false;
              }
              if (database) {
                assertTransactionUsable(database.db);
                // A schema owner interrupted first admission. Reopen after it settles;
                // the schema admitted before the wait no longer describes that handoff.
                if (!isPostgresSqlConnection(database.db)) {
                  invalidateSqliteSchemaFacts(database.db);
                }
                stateDbCache.closeOmnipolymathStateDatabaseByPath(database.path);
                database = undefined;
              }
              return true;
            },
          },
          execute,
        );
  } catch (error) {
    if (database) {
      stateDbCache.evictOmnipolymathStateDatabaseAfterCorruption(database, error);
    }
    throw error;
  }
  try {
    if (!isExistingOmnipolymathStateSchema(committed.database.path, committed.database.db)) {
      ensureOmnipolymathStatePermissions(committed.database.path, options.env ?? process.env);
    }
  } catch {
    // The write already committed; permission hardening is best-effort here so
    // callers never retry an operation that is durable in SQLite.
  }
  return committed.value;
}

/**
 * Return a shared state handle this process already holds open, if any.
 *
 * Read-only callers use this to avoid opening a connection per call; it never
 * creates, repairs, or registers a handle.
 */
function getOmnipolymathStateDatabaseIfOpen(
  options: OmnipolymathStateDatabaseOptions = {},
): OmnipolymathStateDatabase | undefined {
  const pathname = resolveDatabasePath(options);
  isExistingOmnipolymathStateSchema(pathname);
  const cached = stateDbCache.getCachedOmnipolymathStateDatabase(pathname);
  if (cached?.db.isOpen) {
    isExistingOmnipolymathStateSchema(cached.path, cached.db);
  }
  return cached?.db.isOpen ? cached : undefined;
}

export {
  clearOmnipolymathStateDatabaseOpenFailure,
  closeOmnipolymathStateDatabaseByPathAsync,
  closeOmnipolymathStateDatabase,
  closeOmnipolymathStateDatabaseAsync,
  isOmnipolymathStateDatabaseOpen,
  closeOmnipolymathStateDatabaseForTest,
} from "./omnipolymath-state-db-cache.js";
