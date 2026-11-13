import {
  assertStateDatabaseAccessAllowed,
  assertStateDatabaseReadAllowed,
} from "../infra/gateway-state-owner.js";
import { registerNodeSqliteKyselyQueryErrorHandler } from "../infra/kysely-sync-cache-state.js";
import { registerProcessExitCleanup } from "../infra/process-exit-cleanup.js";
import { isPostgresSqlConnection, type EngineConnection } from "../infra/sql-connection.js";
import { isSqliteCorruptionError } from "../infra/sqlite-error-diagnostics.js";
import { throwSqliteLifecycleErrors } from "../infra/sqlite-lifecycle-errors.js";
import { createSqliteTerminalOpenLatch } from "../infra/sqlite-terminal-open-latch.js";
import type { DatabasePathIdentity } from "../infra/sqlite-worker-identity.js";
import { readGlobalSingleton, resolveGlobalSingleton } from "../shared/global-singleton.js";
import { OmnipolymathQuarantineReadCleanupError } from "./omnipolymath-quarantine-error.js";
import { readOmnipolymathDatabaseQuarantineFailure } from "./omnipolymath-quarantine-store.js";
import {
  createOmnipolymathStateDatabaseAsyncLifecycle,
  getOmnipolymathDatabaseMaintenanceScope,
  isOmnipolymathDatabaseMaintenanceResourceOwned,
  observeOmnipolymathDatabaseMaintenanceResource,
  type OmnipolymathStateDatabaseReadAdmission,
} from "./omnipolymath-state-db-async-lifecycle.js";
import {
  assertStateDatabaseBorrowersReleased,
  createStateDatabaseRetainer,
  type StateDatabaseBorrowers,
} from "./omnipolymath-state-db-borrow.js";
import { createStateDatabaseCacheAdmission } from "./omnipolymath-state-db-cache.admission.js";
import { createStateDatabaseIdleRetirement } from "./omnipolymath-state-db-cache.idle.js";
import type { StateDatabaseLifecycle } from "./omnipolymath-state-db-cache.types.js";
import { createStateDatabaseWalOwner } from "./omnipolymath-state-db-cache.wal.js";
import type {
  OmnipolymathStateDatabase,
  OmnipolymathStateDatabaseCloseOptions,
  OmnipolymathStateDatabaseLifecycleEvent,
  StateDatabaseHandle,
} from "./omnipolymath-state-db-contract.js";
import {
  closeStateDatabaseHandle,
  readTrackedStateDatabaseIdentity,
} from "./omnipolymath-state-db-handle.js";
import { invalidateOmnipolymathStateRuntimeIntegrity } from "./omnipolymath-state-db-integrity-admission.js";
import { retainSqliteDatabaseRemovalExclusion } from "./omnipolymath-state-db-removal-exclusion.js";
import { assertExistingOmnipolymathStateSchemaCacheAdmission } from "./omnipolymath-state-db-schema-policy.js";
import { omnipolymathStateSnapshotOwners } from "./omnipolymath-state-db-snapshot-owner.js";
import { resolveDatabasePath } from "./omnipolymath-state-db.paths.js";
import type { OmnipolymathStateWorkerContext } from "./omnipolymath-state-worker-context.types.js";

const STATE_DATABASE_LIFECYCLE_KEY = Symbol.for("omnipolymath.stateDatabaseLifecycle");
const stateDatabaseLifecycle = resolveGlobalSingleton<StateDatabaseLifecycle>(
  STATE_DATABASE_LIFECYCLE_KEY,
  () => ({
    cachedDatabases: new Map<string, OmnipolymathStateDatabase>(),
    retainedDatabaseHandles: new Map<EngineConnection, StateDatabaseHandle>(),
    idleTimers: new WeakMap(),
    idleReferences: new WeakMap(),
    unregisterRetainedExitClose: undefined,
    databaseIdentities: new WeakMap<EngineConnection, DatabasePathIdentity>(),
    borrowers: new WeakMap<EngineConnection, StateDatabaseBorrowers>(),
    databaseLifecycleListeners: new Set<(event: OmnipolymathStateDatabaseLifecycleEvent) => void>(),
    terminalOpenLatch: createSqliteTerminalOpenLatch({
      closeByPath: (pathname, error) => cacheAdmission.closeTerminalFailure(pathname, error),
    }),
    asyncResources: createOmnipolymathStateDatabaseAsyncLifecycle(),
  }),
  () => closeOmnipolymathStateDatabaseAsync(),
  "shared-state",
);
const {
  cachedDatabases,
  retainedDatabaseHandles,
  idleTimers,
  idleReferences,
  databaseIdentities,
  borrowers,
  databaseLifecycleListeners,
  terminalOpenLatch,
  asyncResources,
} = stateDatabaseLifecycle;

const { touch: touchStateDatabase, retain: retainOmnipolymathStateDatabaseForIdle } =
  createStateDatabaseIdleRetirement(stateDatabaseLifecycle, retireOmnipolymathStateDatabaseHandle);
const {
  register: registerStateDatabaseWalAdmission,
  readHealth: readOmnipolymathStateWalHealth,
  ownRetirement: ownStateDatabaseRetirement,
  stop: stopOmnipolymathStateDatabaseMaintenance,
} = createStateDatabaseWalOwner(
  stateDatabaseLifecycle,
  retainOmnipolymathStateDatabaseForIdle,
  requireOmnipolymathStateDatabaseIdentity,
);
export { readOmnipolymathStateWalHealth, retainOmnipolymathStateDatabaseForIdle };

function notifyOmnipolymathStateDatabaseLifecycle(event: OmnipolymathStateDatabaseLifecycleEvent): void {
  const notification =
    event.kind === "open-error"
      ? { ...event, identity: event.identity ?? asyncResources.knownIdentity(event.path) }
      : event;
  for (const listener of databaseLifecycleListeners) {
    listener(notification);
  }
}

function notifyOmnipolymathStateDatabaseClosed(database: StateDatabaseHandle): void {
  notifyOmnipolymathStateDatabaseLifecycle({
    kind: "closed",
    path: database.path,
    identity: requireOmnipolymathStateDatabaseIdentity(database),
  });
}

export function requireOmnipolymathStateDatabaseIdentity(
  database: Pick<StateDatabaseHandle, "db">,
): DatabasePathIdentity {
  const identity = databaseIdentities.get(database.db);
  if (!identity) {
    throw new Error("Published shared-state owner has no recorded database identity");
  }
  return identity;
}

const cacheAdmission = createStateDatabaseCacheAdmission({
  cachedDatabases,
  evict: evictCachedOmnipolymathStateDatabase,
  invalidate: (pathname) => asyncResources.invalidate(pathname),
  notifyTerminalFailure: (pathname, error) =>
    notifyOmnipolymathStateDatabaseLifecycle({
      kind: "terminal-failure",
      path: pathname,
      error,
      identity: asyncResources.knownIdentity(pathname),
    }),
});

export function registerOmnipolymathStateDatabaseLifecycleListener(
  listener: (event: OmnipolymathStateDatabaseLifecycleEvent) => void,
): () => void {
  databaseLifecycleListeners.add(listener);
  for (const database of cachedDatabases.values()) {
    if (database.db.isOpen) {
      listener({
        kind: "opened",
        database,
        identity: requireOmnipolymathStateDatabaseIdentity(database),
      });
    }
  }
  return () => databaseLifecycleListeners.delete(listener);
}

/** Invalidate path-scoped projections on non-open database lifecycle events. */
export function registerOmnipolymathStatePathCacheInvalidation<Key, Value extends { path: string }>(
  cache: Map<Key, Value>,
): () => void {
  return registerOmnipolymathStateDatabaseLifecycleListener((event) => {
    if (event.kind !== "opened") {
      for (const [key, value] of cache) {
        if (value.path === (event.identity?.canonicalPath ?? event.path)) {
          cache.delete(key);
        }
      }
    }
  });
}

function retainStateDatabaseClose(database: StateDatabaseHandle): void {
  retainedDatabaseHandles.set(database.db, database);
  stateDatabaseLifecycle.unregisterRetainedExitClose ??= registerProcessExitCleanup(
    closeOmnipolymathStateDatabase,
  );
}

function ownMaintenanceStateDatabaseHandle(database: StateDatabaseHandle): void {
  getOmnipolymathDatabaseMaintenanceScope()?.own(database.db, "shared-handles", async () => {
    const closingScope = getOmnipolymathDatabaseMaintenanceScope();
    if (!closingScope || !isOmnipolymathDatabaseMaintenanceResourceOwned(database.db, closingScope)) {
      return;
    }
    if (
      cachedDatabases.get(database.path) === database ||
      retainedDatabaseHandles.get(database.db) === database
    ) {
      await database.walMaintenance?.stop();
      if (
        isOmnipolymathDatabaseMaintenanceResourceOwned(database.db, closingScope) &&
        (cachedDatabases.get(database.path) === database ||
          retainedDatabaseHandles.get(database.db) === database)
      ) {
        retireOmnipolymathStateDatabaseHandle(database, false);
      }
    }
  });
}

function closeUnpublishedOmnipolymathStateDatabaseHandle(database: StateDatabaseHandle): unknown[] {
  const errors = closeOmnipolymathStateDatabaseHandle(database);
  if (retainedDatabaseHandles.get(database.db) === database) {
    ownMaintenanceStateDatabaseHandle(database);
  }
  return errors;
}

/** Retain one exact canonical native owner; only the final reference retires its handle. */
export const {
  retain: retainOmnipolymathStateDatabase,
  borrowForRead: borrowOmnipolymathStateDatabaseForAsyncRead,
  retainForIndependentRead: retainOmnipolymathStateDatabaseForIndependentRead,
} = createStateDatabaseRetainer(stateDatabaseLifecycle, {
  assertOpen(pathname, ownership) {
    assertOmnipolymathStateDatabaseOpenAllowed(pathname, ownership);
    assertExistingOmnipolymathStateSchemaCacheAdmission(pathname, stateDatabaseLifecycle);
  },
  capture: (pathname) => asyncResources.capture(pathname),
  retire: retireOmnipolymathStateDatabaseHandle,
  retainFailed: retainStateDatabaseClose,
  ownRetirement: ownStateDatabaseRetirement,
  touch: touchStateDatabase,
});

/** Close both physical-handle owners while retaining every cleanup failure. */
function closeOmnipolymathStateDatabaseHandle(
  database: StateDatabaseHandle,
  options?: Parameters<OmnipolymathStateDatabase["walMaintenance"]["close"]>[0],
): unknown[] {
  clearTimeout(idleTimers.get(database.db));
  idleTimers.delete(database.db);
  try {
    assertStateDatabaseBorrowersReleased(borrowers.get(database.db), database.path);
  } catch (error) {
    const owner = borrowers.get(database.db);
    if (owner) {
      owner.retiring = true;
      // Deferred native cleanup keeps this exact request, not the last read pin's scope.
      owner.retirement = {
        ordinary: true,
        isCurrent: () => true,
        retire: () => {
          throwSqliteLifecycleErrors(
            closeOmnipolymathStateDatabaseHandle(database, options),
            `Omnipolymath state database cleanup failed for ${database.path}.`,
          );
          owner.cleanupComplete = true;
          borrowers.delete(database.db);
        },
      };
    }
    retainStateDatabaseClose(database);
    return [error];
  }
  idleReferences.delete(database.db);
  omnipolymathStateSnapshotOwners.release(database.db);
  const { errors, cleanupPending } = closeStateDatabaseHandle(database, options);
  if (database.db.isOpen || cleanupPending) {
    retainStateDatabaseClose(database);
  } else {
    retainedDatabaseHandles.delete(database.db);
  }
  // A failed native close retains physical custody, never a successful cache hit.
  if (cachedDatabases.get(database.path)?.db === database.db) {
    cachedDatabases.delete(database.path);
  }
  if (retainedDatabaseHandles.size === 0) {
    stateDatabaseLifecycle.unregisterRetainedExitClose?.();
    stateDatabaseLifecycle.unregisterRetainedExitClose = undefined;
  }
  return errors;
}

function evictCachedOmnipolymathStateDatabase(database: OmnipolymathStateDatabase): boolean {
  if (!isPostgresSqlConnection(database.db)) {
    invalidateOmnipolymathStateRuntimeIntegrity(database.db);
  }
  if (cachedDatabases.get(database.path) !== database) {
    return false;
  }
  // Remove ownership before cleanup. A poisoned native handle can reject close,
  // but it must never remain discoverable as the process-wide shared handle.
  asyncResources.invalidate(database.path);
  cachedDatabases.delete(database.path);
  notifyOmnipolymathStateDatabaseClosed(database);
  // A poisoned cache owner is not the database lifecycle owner. PASSIVE avoids
  // waiting on readers or resetting recovery frames another connection needs.
  closeOmnipolymathStateDatabaseHandle(database, { checkpointMode: "PASSIVE" });
  return true;
}

/** Evict an exact cached shared-state owner after a proven corruption read. */
function evictOmnipolymathStateDatabaseAfterCorruption(
  database: OmnipolymathStateDatabase,
  error: unknown,
): boolean {
  return isSqliteCorruptionError(error) && evictCachedOmnipolymathStateDatabase(database);
}

/** Publish a fully opened handle and bind query corruption to its exact cache owner. */
function publishOmnipolymathStateDatabase(
  database: OmnipolymathStateDatabase,
  env: NodeJS.ProcessEnv,
): OmnipolymathStateDatabase {
  const { db, path: pathname } = database;
  const { identity, admission } = asyncResources.publish(pathname);
  // Lifecycle settlement retains this projection after native disposal clears its identity.
  databaseIdentities.set(db, readTrackedStateDatabaseIdentity(db) ?? identity);
  cachedDatabases.set(pathname, database);
  registerStateDatabaseWalAdmission(database, identity, admission, env);
  touchStateDatabase(database);
  omnipolymathStateSnapshotOwners.register(database, () => cachedDatabases.get(pathname));
  ownMaintenanceStateDatabaseHandle(database);
  notifyOmnipolymathStateDatabaseLifecycle({ kind: "opened", database, identity });
  if (!isPostgresSqlConnection(db)) {
    registerNodeSqliteKyselyQueryErrorHandler(db, (error) => {
      // Write transactions own rollback and evict at their outer boundary.
      if (!db.isTransaction && isSqliteCorruptionError(error)) {
        evictCachedOmnipolymathStateDatabase(database);
      }
    });
  }
  terminalOpenLatch.clear(pathname);
  return database;
}

/** Looking up an admitted handle does not consume schema or row facts. */
function getCachedOmnipolymathStateDatabase(
  pathname: string,
  options?: { readOnly: true },
): OmnipolymathStateDatabase | undefined {
  const resolvedPath = resolveDatabasePath({ path: pathname });
  const runtimeFailure = terminalOpenLatch.get(resolvedPath);
  if (runtimeFailure) {
    throw runtimeFailure;
  }
  const database = readCachedOmnipolymathStateDatabase(resolvedPath, options?.readOnly === true);
  if (database) {
    touchStateDatabase(database);
  }
  return database;
}

function readCachedOmnipolymathStateDatabase(
  resolvedPath: string,
  readOnly: boolean,
): OmnipolymathStateDatabase | undefined {
  const maintenance = getOmnipolymathDatabaseMaintenanceScope();
  if (readOnly) {
    maintenance?.assertReadAdmission();
  } else {
    maintenance?.assertAdmission();
  }
  assertExistingOmnipolymathStateSchemaCacheAdmission(resolvedPath, stateDatabaseLifecycle);
  const database = cachedDatabases.get(resolvedPath);
  if (database && borrowers.get(database.db)?.retiring) {
    throw new Error(`Omnipolymath state database native borrower cleanup is pending: ${resolvedPath}`);
  }
  return database;
}

/** Fact checks retain admission, not idle handles; native transactions expose staged facts. */
export function prepareOmnipolymathStateCachedRead(pathname: string) {
  const resolvedPath = resolveDatabasePath({ path: pathname });
  getCachedOmnipolymathStateDatabase(resolvedPath, { readOnly: true });
  // Terminal failures invalidate this admission before closing the native owner.
  const admission = asyncResources.capture(resolvedPath);
  return () => {
    admission.assertCurrent();
    return readCachedOmnipolymathStateDatabase(resolvedPath, true);
  };
}

/** Keep the admitted revision live while a synchronous reader consumes its row facts. */
function withCachedOmnipolymathStateDatabase<T>(
  pathname: string,
  options: { readOnly: true } | undefined,
  operation: (database: OmnipolymathStateDatabase) => T,
): T | undefined {
  const database = getCachedOmnipolymathStateDatabase(pathname, options);
  return database && cacheAdmission.read(database, operation);
}

function getOmnipolymathStateDatabaseIfOpenAtPath(pathname: string): OmnipolymathStateDatabase | undefined {
  const cached = getCachedOmnipolymathStateDatabase(pathname);
  observeOmnipolymathDatabaseMaintenanceResource(cached?.db.isOpen ? cached.db : undefined);
  return cached?.db.isOpen ? cached : undefined;
}

/** Remove a closed cached owner while fresh-open access is held. */
function closeStaleCachedOmnipolymathStateDatabase(database: OmnipolymathStateDatabase): void {
  if (cachedDatabases.get(database.path) !== database) {
    return;
  }
  asyncResources.invalidate(database.path);
  const errors = closeOmnipolymathStateDatabaseHandle(database);
  notifyOmnipolymathStateDatabaseClosed(database);
  throwSqliteLifecycleErrors(
    errors,
    `Stale Omnipolymath state database cleanup failed for ${database.path}.`,
  );
}

/** Latch integrity refusals so later opens fail without rescanning. */
export function recordOmnipolymathStateDatabaseOpenFailure(pathname: string, error: Error): void {
  terminalOpenLatch.record(resolveDatabasePath({ path: pathname }), error);
}

/** Clear a terminal open failure after doctor rewrites the database file. */
export function clearOmnipolymathStateDatabaseOpenFailure(pathname: string): void {
  const resolvedPath = resolveDatabasePath({ path: pathname });
  terminalOpenLatch.clear(resolvedPath);
  asyncResources.invalidate(resolvedPath);
  notifyOmnipolymathStateDatabaseLifecycle({
    kind: "failure-cleared",
    path: resolvedPath,
    identity: asyncResources.knownIdentity(resolvedPath),
  });
}

/** Validate the canonical terminal fact before acquiring a domain-operation lease. */
export async function getOmnipolymathStateDatabaseTerminalFailureAsync(
  context: OmnipolymathStateWorkerContext,
  signal?: AbortSignal,
): Promise<Error | undefined> {
  context.admission.assertCurrent();
  signal?.throwIfAborted();
  return terminalOpenLatch.get(context.admission.databasePath);
}

/** Reject shared-state access after a process-local terminal failure. */
function assertOmnipolymathStateDatabaseOpenAllowed(pathname: string, ownership?: "cached-read"): void {
  const resolvedPath = resolveDatabasePath({ path: pathname });
  const assertAllowed =
    ownership === "cached-read" ? assertStateDatabaseReadAllowed : assertStateDatabaseAccessAllowed;
  assertAllowed(pathname);
  const { identity } = asyncResources.capture(resolvedPath);
  const terminalFailure = terminalOpenLatch.get(resolvedPath);
  if (terminalFailure) {
    throw terminalFailure;
  }
  for (const database of retainedDatabaseHandles.values()) {
    if (
      borrowers.get(database.db)?.retiring &&
      (database.path === resolvedPath || databaseIdentities.get(database.db)?.key === identity.key)
    ) {
      throw new Error(`Omnipolymath state database native borrower cleanup is pending: ${pathname}`);
    }
  }
}

function recordOmnipolymathStateDatabaseLifecycleOpenError(pathname: string, error: unknown): void {
  const resolvedPath = resolveDatabasePath({ path: pathname });
  notifyOmnipolymathStateDatabaseLifecycle({ kind: "open-error", path: resolvedPath, error });
}

function assertOmnipolymathStateDatabaseFreshOpenAllowedAtPath(
  pathname: string,
  env: NodeJS.ProcessEnv,
  onNativeCleanupFailure?: (error: OmnipolymathQuarantineReadCleanupError) => void,
  refreshQuarantineIdentity?: true,
): void {
  assertOmnipolymathStateDatabaseOpenAllowed(pathname);
  let quarantineFailure: Error | undefined;
  try {
    const options = { env, refreshIdentity: refreshQuarantineIdentity };
    quarantineFailure = readOmnipolymathDatabaseQuarantineFailure("state", pathname, options);
  } catch (error) {
    if (!(error instanceof OmnipolymathQuarantineReadCleanupError)) {
      throw error;
    }
    onNativeCleanupFailure?.(error);
  }
  if (quarantineFailure?.cause instanceof OmnipolymathQuarantineReadCleanupError) {
    onNativeCleanupFailure?.(quarantineFailure.cause);
  }
  if (quarantineFailure) {
    // Revoke owners without a process-local latch that could outlive the durable decision.
    cacheAdmission.closeTerminalFailure(pathname, quarantineFailure);
    throw quarantineFailure;
  }
}

/** SQLite owns checkpoint exclusion; retirement joins the actual native handle. */
function retireOmnipolymathStateDatabaseHandle(
  database: StateDatabaseHandle,
  retireAdmission = true,
  options?: OmnipolymathStateDatabaseCloseOptions,
): void {
  // Retained native custody permits disposal after the caller loses admission.
  assertStateDatabaseBorrowersReleased(borrowers.get(database.db), database.path);
  const borrowedOwner = borrowers.get(database.db);
  try {
    const wasCached = cachedDatabases.get(database.path)?.db === database.db;
    if (retireAdmission) {
      asyncResources.invalidate(database.path);
    }
    const errors = closeOmnipolymathStateDatabaseHandle(database, options);
    if (wasCached && retireAdmission) {
      try {
        notifyOmnipolymathStateDatabaseClosed(database);
      } catch (error) {
        errors.push(error);
      }
    }
    throwSqliteLifecycleErrors(
      errors,
      `Omnipolymath state database cleanup failed for ${database.path}.`,
    );
  } catch (error) {
    if (borrowedOwner) {
      retainStateDatabaseClose(database);
    }
    throw error;
  }
  if (borrowedOwner) {
    borrowedOwner.cleanupComplete = true;
    borrowers.delete(database.db);
  }
}

/** Close cached and disposal-only handles, preserving independent cleanup failures. */
function retireOmnipolymathStateDatabaseHandles(
  pathname?: string,
  options?: OmnipolymathStateDatabaseCloseOptions,
  identity?: DatabasePathIdentity,
): boolean {
  const databases = new Set<StateDatabaseHandle>([
    ...retainedDatabaseHandles.values(),
    ...cachedDatabases.values(),
  ]);
  const errors: unknown[] = [];
  let found = false;
  for (const database of databases) {
    if (
      pathname !== undefined &&
      database.path !== pathname &&
      (identity === undefined || databaseIdentities.get(database.db)?.key !== identity.key)
    ) {
      continue;
    }
    found = true;
    try {
      retireOmnipolymathStateDatabaseHandle(database, true, options);
    } catch (error) {
      errors.push(error);
    }
  }
  throwSqliteLifecycleErrors(errors, "Omnipolymath state database cleanup failed.");
  return found;
}

export function closeOmnipolymathStateDatabaseByPath(
  pathname: string,
  options?: OmnipolymathStateDatabaseCloseOptions,
): boolean {
  return retireOmnipolymathStateDatabaseHandles(
    resolveDatabasePath({ path: pathname }),
    options,
    asyncResources.identity(pathname),
  );
}

export function closeOmnipolymathStateDatabase(options?: OmnipolymathStateDatabaseCloseOptions): void {
  retireOmnipolymathStateDatabaseHandles(undefined, options);
}

/** Register a resource owner before it can admit any shared-state worker opens. */
export const registerOmnipolymathStateDatabaseAsyncResource = asyncResources.register;

/** Close the admitted file or its canonical path, retaining first-creation identity getters. */
export function registerOmnipolymathStatePathAsyncResource(
  admission: Pick<OmnipolymathStateDatabaseReadAdmission, "identity">,
  close: () => Promise<void>,
): () => void {
  return registerOmnipolymathStateDatabaseAsyncResource({
    close(identity) {
      if (
        !identity ||
        identity.key === admission.identity.key ||
        identity.canonicalPath === admission.identity.canonicalPath
      ) {
        return close();
      }
      return Promise.resolve();
    },
  });
}

/** Capture the canonical read generation before any asynchronous worker admission. */
export const captureOmnipolymathStateDatabaseReadAdmission = asyncResources.capture;

export const captureOmnipolymathStateIntegrityAdmission = asyncResources.integrity;

/** Bind worker-created storage to its captured admission without publishing a native handle. */
export function publishOmnipolymathStateDatabaseWorkerAdmission(
  admission: OmnipolymathStateDatabaseReadAdmission,
  preparedIdentity?: DatabasePathIdentity,
): void {
  if (preparedIdentity) {
    admission.assertCurrent();
  }
  asyncResources.publish(admission.databasePath, preparedIdentity);
  admission.assertCurrent();
}

/** Drain worker resources before native checkpoint/close at one exact path. */
export function closeOmnipolymathStateDatabaseByPathAsync(
  pathname: string,
  options?: OmnipolymathStateDatabaseCloseOptions,
): Promise<boolean> {
  const resolvedPath = resolveDatabasePath({ path: pathname });
  return asyncResources.close(resolvedPath, async (identity) => {
    await stopOmnipolymathStateDatabaseMaintenance(resolvedPath, identity);
    return retireOmnipolymathStateDatabaseHandles(resolvedPath, options, identity);
  });
}

/**
 * Drain worker-held connections at one path while its native owner stays open.
 * In WAL mode every idle connection holds a shared lock, so native exclusion needs this.
 */
export function closeOmnipolymathStateDatabaseWorkersByPathAsync(pathname: string): Promise<boolean> {
  return asyncResources.close(resolveDatabasePath({ path: pathname }), () => false);
}

/** Orderly lifecycle close; synchronous close remains native/exit cleanup only. */
export async function closeOmnipolymathStateDatabaseAsync(
  options?: OmnipolymathStateDatabaseCloseOptions,
): Promise<void> {
  await asyncResources.close(undefined, async () => {
    await stopOmnipolymathStateDatabaseMaintenance();
    return retireOmnipolymathStateDatabaseHandles(undefined, options);
  });
}

export function isOmnipolymathStateDatabaseOpen(pathname?: string): boolean {
  if (pathname !== undefined) {
    return cachedDatabases.get(resolveDatabasePath({ path: pathname }))?.db.isOpen === true;
  }
  return Array.from(cachedDatabases.values()).some((database) => database.db.isOpen);
}

/**
 * Close shared state handles and clear terminal failure latches for test isolation.
 * Worker retirement continues after return; await closeOmnipolymathStateDatabaseAsync()
 * before raw SQLite or file access to a database that workers have used.
 */
export function closeOmnipolymathStateDatabaseForTest(): void {
  closeOmnipolymathStateDatabase();
  terminalOpenLatch.clearAll();
}

/**
 * Owners that register with this cache must serve only the published lifecycle.
 * Every runtime chunk shares that lifecycle; only a retired module generation
 * (a re-evaluated test graph whose detached work outlived its file) can differ.
 */
export function assertPublishedOmnipolymathStateDatabaseLifecycle(): void {
  if (readGlobalSingleton(STATE_DATABASE_LIFECYCLE_KEY) !== stateDatabaseLifecycle) {
    throw new Error(
      "Omnipolymath state database lifecycle is retired; its owners cannot serve the published lifecycle",
    );
  }
}

/** Process-wide owner for cached shared-state handles and terminal open failures. */
export const omnipolymathStateDatabaseCache = {
  assertOmnipolymathStateDatabaseFreshOpenAllowedAtPath,
  assertOmnipolymathStateDatabaseOpenAllowed,
  clearOmnipolymathStateDatabaseOpenFailure,
  closeOmnipolymathStateDatabase,
  closeOmnipolymathStateDatabaseByPath,
  closeOmnipolymathStateDatabaseForTest,
  closeOmnipolymathStateDatabaseHandle,
  closeUnpublishedOmnipolymathStateDatabaseHandle,
  closeStaleCachedOmnipolymathStateDatabase,
  evictCachedOmnipolymathStateDatabase,
  evictOmnipolymathStateDatabaseAfterCorruption,
  getCachedOmnipolymathStateDatabase,
  // Identity only: re-enter retained transaction custody before ordinary access admission.
  peekOmnipolymathStateDatabaseConnection: (pathname: string): EngineConnection | undefined =>
    cachedDatabases.get(resolveDatabasePath({ path: pathname }))?.db,
  withCachedOmnipolymathStateDatabase,
  getOmnipolymathStateDatabaseRecordedFailure: terminalOpenLatch.peek,
  getOmnipolymathStateDatabaseIfOpenAtPath,
  getKnownOmnipolymathStateDatabaseIdentity: asyncResources.knownIdentity,
  isOmnipolymathStateDatabaseOpen,
  /** Only the exact published, open owner carries canonical schema readiness. */
  isOmnipolymathStateDatabaseSchemaReady: (database: OmnipolymathStateDatabase): boolean =>
    cachedDatabases.get(database.path) === database && database.db.isOpen,
  publishOmnipolymathStateDatabase,
  recordOmnipolymathStateDatabaseOpenFailure,
  recordOmnipolymathStateDatabaseLifecycleOpenError,
  touchStateDatabase,
};

/** Offline removal drains local work and refuses an active native SQLite owner. */
export async function prepareOmnipolymathStateDatabaseRemoval(
  pathname: string,
  assertOwnerCurrent: () => void,
) {
  const databasePath = resolveDatabasePath({ path: pathname });
  const maintenance = getOmnipolymathDatabaseMaintenanceScope();
  if (!maintenance?.ownsSchemaMaintenance) {
    throw new Error("State removal requires the installation's maintenance owner");
  }
  maintenance.assertAdmission();
  const releaseAdmission = asyncResources.holdExclusion(databasePath);
  try {
    await closeOmnipolymathStateDatabaseByPathAsync(databasePath);
    maintenance.assertOwnerCurrent();
    retainSqliteDatabaseRemovalExclusion(databasePath, maintenance);
    maintenance.assertOwnerCurrent();
  } catch (error) {
    releaseAdmission();
    throw error;
  }
  let active = true;
  return {
    assertCurrent() {
      if (!active) {
        throw new Error("State removal admission has been released");
      }
      assertOwnerCurrent();
    },
    release() {
      if (active) {
        active = false;
        releaseAdmission();
      }
    },
  };
}
