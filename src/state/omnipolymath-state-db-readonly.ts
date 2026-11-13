import { AsyncLocalStorage } from "node:async_hooks";
import { lstatSync } from "node:fs";
import { isMainThread } from "node:worker_threads";
import { isPromiseLike } from "@omnipolymath/normalization-core/promise-like";
import { withEngineStoreAdmission } from "../infra/database-engine/admission-scope.js";
import { hasErrnoCode } from "../infra/errno.js";
import { SqliteCoordinatorError } from "../infra/sqlite-lifecycle-errors.js";
import { retainSnapshotWork } from "../infra/sqlite-readonly-location-cleanup.js";
import {
  prepareSqliteReadOnlyLocation,
  prepareSqliteReadOnlyLocationSync,
} from "../infra/sqlite-snapshot-source.js";
import { isUpdateRehearsalPrivateDatabase } from "../infra/update-rehearsal-paths.js";
import { runPluginSharedStateWork } from "../plugins/plugin-shared-state-admission.js";
import { getAsyncWorkSignal } from "../shared/async-work-scope.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import {
  artifactPreservingReads,
  isLiveStateRead,
  isArtifactPreservingStateRead,
  withArtifactPreservingStateReads,
} from "./artifact-preserving-state-reads.js";
import {
  captureOmnipolymathStateDatabaseReadAdmission,
  omnipolymathStateDatabaseCache,
} from "./omnipolymath-state-db-cache.js";
import { readAdmittedStateContentVersion } from "./omnipolymath-state-db-content-version.js";
import type {
  OmnipolymathStateDatabaseOptions,
  OmnipolymathStateSchemaReadAdmission,
} from "./omnipolymath-state-db-contract.js";
import { assertStateFileSnapshotAllowed, isStatePostgres } from "./omnipolymath-state-db-engine.js";
import {
  assertStateReadSchema,
  openOmnipolymathStateReadOnlyLocation,
  withOmnipolymathStateReadOnlyLocation,
} from "./omnipolymath-state-db-read-connection.js";
import {
  withCachedOmnipolymathStateDatabaseReadOnly,
  withMaintenanceOmnipolymathStateDatabaseReadOnly,
  type ReusedOmnipolymathStateReadOnlyDatabase,
} from "./omnipolymath-state-db-readonly-reuse.js";
import { isExistingOmnipolymathStateSchema } from "./omnipolymath-state-db-schema-policy.js";
import { existingPathOrUndefined, resolveDatabasePath } from "./omnipolymath-state-db.paths.js";
import { getOmnipolymathDatabaseMaintenanceScope } from "./omnipolymath-state-maintenance-context.js";
import { postgresStateReadSnapshot } from "./omnipolymath-state-postgres-snapshot-context.js";
import {
  isStateReadReply,
  startOmnipolymathStateReadOperation,
  type OmnipolymathStateReadCompletion,
  type StateReadReply,
} from "./omnipolymath-state-read-operation.js";
import {
  assertRetainedReadScopeAdmission,
  bindRetainedReadScope,
  createRetainedReadScope,
  readRetainedStateSnapshot,
  runRetainedReadScope,
  runSynchronousReadScope,
} from "./omnipolymath-state-read-scope.js";
import {
  prepareOmnipolymathStateReadSnapshotSource,
  type StateReadSnapshotSource,
} from "./omnipolymath-state-read-snapshot-source.js";
import type {
  OmnipolymathStateReadReceipt,
  OmnipolymathStateReadOptions,
  OmnipolymathStateReadCommand,
  OmnipolymathStateReadOnlyDatabase,
  RetainedReadScope,
} from "./omnipolymath-state-read.types.js";
import { captureOmnipolymathStateReadWorkerContext } from "./omnipolymath-state-worker-context.js";

export { isArtifactPreservingStateRead, withArtifactPreservingStateReads };

const REUSE_IMAGE = { reuse: true } as const;
const disposableStateReads = resolveGlobalSingleton(
  Symbol.for("omnipolymath.disposableStateReads"),
  () => new AsyncLocalStorage<RetainedReadScope[]>(),
);

const stateSnapshotReads = resolveGlobalSingleton(
  Symbol.for("omnipolymath.stateSnapshotReads"),
  () =>
    new AsyncLocalStorage<
      RetainedReadScope & {
        readSource(): StateReadSnapshotSource | undefined;
        prepareSource?: () => Promise<void>;
        forkSource: Awaited<
          ReturnType<typeof prepareOmnipolymathStateReadSnapshotSource>
        >["forkSource"];
        recoverRollbackJournal: () => void;
        env: NodeJS.ProcessEnv;
        callerSignal?: AbortSignal;
      }
    >(),
);

function exitStateReadSnapshot<T>(operation: () => T): T {
  return stateSnapshotReads.exit(() => postgresStateReadSnapshot.exit(operation));
}

function resolveStateReadCallerSignal(): AbortSignal | undefined {
  const signal = getAsyncWorkSignal();
  const snapshot = stateSnapshotReads.getStore();
  // Snapshot drainage closes physical custody; only the caller can cancel an admitted read.
  return snapshot && signal === snapshot.work.signal ? snapshot.callerSignal : signal;
}

/** Scope membership must not materialize private bytes just to select a reader/cache. */
export function hasActiveOmnipolymathStateDatabaseReadSnapshot(
  options: OmnipolymathStateDatabaseOptions = {},
): boolean {
  const current = stateSnapshotReads.getStore();
  return current?.active === true && current.path === resolveOmnipolymathStateReadPath(options);
}

/** Selected live or private source within the enclosing read admission. */
export function getActiveOmnipolymathStateDatabaseReadSnapshot(
  options: OmnipolymathStateDatabaseOptions = {},
): Readonly<{ location: string }> | undefined {
  const current = stateSnapshotReads.getStore();
  return current?.path === resolveOmnipolymathStateReadPath(options) ? current.readSource() : undefined;
}

/** Prepare lazy snapshot bytes without blocking asynchronous discovery callers. */
export async function getActiveOmnipolymathStateDatabaseReadSnapshotAsync(
  options: OmnipolymathStateDatabaseOptions = {},
): Promise<Readonly<{ location: string }> | undefined> {
  const current = stateSnapshotReads.getStore();
  if (current?.path !== resolveOmnipolymathStateReadPath(options)) {
    return undefined;
  }
  // Retain preparation through cancellation/drainage, then recheck read admission
  // before publishing the same identity used by synchronous readers.
  return current.work.track(async () => {
    await current.prepareSource?.();
    resolveStateReadCallerSignal()?.throwIfAborted();
    return getActiveOmnipolymathStateDatabaseReadSnapshot(options);
  });
}

/** Fork only bytes already owned by this matching report, retaining it until the child settles. */
export async function forkActiveOmnipolymathStateDatabaseReadSnapshot(
  options: OmnipolymathStateDatabaseOptions = {},
) {
  const pathname = resolveOmnipolymathStateReadPath(options);
  const current = stateSnapshotReads.getStore();
  if (current?.path !== pathname) {
    return undefined;
  }
  assertRetainedReadScopeAdmission(pathname, [current]);
  const signal = resolveStateReadCallerSignal();
  signal?.throwIfAborted();
  return current.work.track(() => current.forkSource(signal));
}

type StateReadScopeOptions = OmnipolymathStateDatabaseOptions & {
  admissionTimeoutMs?: number;
  /** Only startup may inspect a hot journal privately before guarded canonical recovery. */
  allowStartupRollbackRecovery?: true;
  /** Selected reports acquire shared bytes only when a reader actually needs them. */
  lazy?: boolean;
  /** Command owners may cancel preparation before the callback acquires its read scope. */
  signal?: AbortSignal;
};

/** Retain private inspection bytes or live read admission without redirecting writers. */
export async function withOmnipolymathStateDatabaseReadSnapshot<T>(
  operation: () => Promise<T>,
  options: StateReadScopeOptions = {},
): Promise<T> {
  const live = isLiveStateRead();
  const inheritedSignal = resolveStateReadCallerSignal();
  const callerSignal =
    options.signal && inheritedSignal
      ? AbortSignal.any([options.signal, inheritedSignal])
      : (options.signal ?? inheritedSignal);
  callerSignal?.throwIfAborted();
  const postgres = isStatePostgres();
  const pathname = resolveOmnipolymathStateReadPath(options);
  const current = stateSnapshotReads.getStore();
  const lazy = options.lazy === true && !postgres && !live;
  if (
    (current?.active && current.path === pathname) ||
    (!lazy && !existingPathOrUndefined(pathname))
  ) {
    return await operation();
  }
  const env = options.env ?? process.env;
  const controller = new AbortController();
  let closeSnapshotWork: ((reason: unknown) => void) | undefined;
  const run = async () => {
    const source = await prepareOmnipolymathStateReadSnapshotSource({
      pathname,
      env,
      postgres,
      lazy,
      controller,
      callerSignal,
      admissionTimeoutMs: options.admissionTimeoutMs,
      allowStartupRollbackRecovery: options.allowStartupRollbackRecovery === true,
      live,
    });
    let readSucceeded = false;
    const snapshot = Object.assign(
      createRetainedReadScope(pathname, source.identity, () => source.cleanup(readSucceeded)),
      {
        readSource: source.readSource,
        prepareSource: source.prepareSource,
        forkSource: source.forkSource,
        recoverRollbackJournal: source.recoverRollbackJournal,
        env,
        callerSignal,
      },
    );
    const bind = () => stateSnapshotReads.run(snapshot, () => bindRetainedReadScope(snapshot));
    const lifecycle = source.postgresSnapshot
      ? postgresStateReadSnapshot.run({ path: pathname, snapshot: source.postgresSnapshot }, bind)
      : bind();
    closeSnapshotWork = lifecycle.abort;
    const closeFromCaller = () => lifecycle.abort(callerSignal?.reason);
    callerSignal?.addEventListener("abort", closeFromCaller, { once: true });
    if (callerSignal?.aborted) {
      closeFromCaller();
    }
    try {
      return await lifecycle.run(async () => {
        controller.signal.throwIfAborted();
        source.assertCurrent();
        const result = await operation();
        readSucceeded = true;
        return result;
      });
    } finally {
      callerSignal?.removeEventListener("abort", closeFromCaller);
    }
  };
  return await retainSnapshotWork(run(), () => {
    controller.abort(new Error("Shared-state snapshot admission closed"));
    closeSnapshotWork?.(controller.signal.reason);
  });
}

/** Startup calls this only after validating config and its current live-owner guard. */
export function recoverOmnipolymathStateRollbackJournalForStartup(
  options: OmnipolymathStateDatabaseOptions = {},
): void {
  const pathname = resolveOmnipolymathStateReadPath(options);
  const current = stateSnapshotReads.getStore();
  if (current?.path === pathname) {
    assertRetainedReadScopeAdmission(pathname, [current]);
    current.recoverRollbackJournal();
  }
}

/** The caller owns this private database and removes its files after the scope closes. */
export async function withDisposableOmnipolymathStateReads<T>(
  pathname: string,
  operation: () => Promise<T>,
): Promise<T> {
  const resolvedPath = resolveOmnipolymathStateReadPath({ path: pathname });
  const scope = createRetainedReadScope(
    resolvedPath,
    captureOmnipolymathStateDatabaseReadAdmission(resolvedPath).identity,
  );
  return await runRetainedReadScope(scope, () =>
    disposableStateReads.run([...(disposableStateReads.getStore() ?? []), scope], operation),
  );
}

function requiresArtifactPreservingSnapshot(pathname: string): boolean {
  // PostgreSQL reads use the admitted connection's read-only transaction, never a copied anchor.
  if (isStatePostgres() || isLiveStateRead()) {
    return false;
  }
  const required =
    isArtifactPreservingStateRead("shared", pathname) &&
    !isUpdateRehearsalPrivateDatabase(pathname, process.env) &&
    !disposableStateReads.getStore()?.some((scope) => scope.active && scope.path === pathname);
  if (required) {
    assertStateFileSnapshotAllowed();
  }
  return required;
}

type ScopedRead = ReturnType<typeof openOmnipolymathStateReadOnlyLocation>;
const synchronousReadSnapshots = resolveGlobalSingleton(
  Symbol.for("omnipolymath.synchronousStateReadSnapshots"),
  (): { current: Map<string, ScopedRead> | undefined; currentAuthorityPath?: string } => ({
    current: undefined,
  }),
);

/** One synchronous metadata operation shares private bytes, never later admission reads. */
export function withSynchronousArtifactPreservingStateSnapshot<T>(
  operation: () => T,
  options?: { current?: OmnipolymathStateDatabaseOptions },
): T {
  if (options?.current) {
    // Check inherited admission before selecting fresh bytes for this assertion.
    const pathname = resolveOmnipolymathStateReadPath(options.current);
    const inherited = synchronousReadSnapshots.current;
    const inheritedAuthority = synchronousReadSnapshots.currentAuthorityPath;
    if (inherited && inheritedAuthority === pathname) {
      // A composite assertion already selected fresh bytes for this database.
      return operation();
    }
    return exitStateReadSnapshot(() => {
      synchronousReadSnapshots.current = undefined;
      synchronousReadSnapshots.currentAuthorityPath = pathname;
      try {
        return withArtifactPreservingStateReads(() =>
          withSynchronousArtifactPreservingStateSnapshot(operation),
        );
      } finally {
        synchronousReadSnapshots.current = inherited;
        synchronousReadSnapshots.currentAuthorityPath = inheritedAuthority;
      }
    });
  }
  if (!isArtifactPreservingStateRead() || synchronousReadSnapshots.current) {
    return operation();
  }
  const readers = new Map<string, ScopedRead>();
  synchronousReadSnapshots.current = readers;
  return runSynchronousReadScope(
    {
      readers,
      leave: () => {
        synchronousReadSnapshots.current = undefined;
      },
    },
    operation,
  );
}

export function resolveOmnipolymathStateReadPath(options: OmnipolymathStateDatabaseOptions): string {
  const pathname = resolveDatabasePath(options);
  assertOmnipolymathStateReadPathCurrent(pathname);
  return pathname;
}

/** Prepared paths still honor the invoking reader and schema owner's live admission. */
export function assertOmnipolymathStateReadPathCurrent(pathname: string): void {
  const snapshot = stateSnapshotReads.getStore();
  const disposable = disposableStateReads.getStore();
  if (snapshot || disposable?.length) {
    assertRetainedReadScopeAdmission(pathname, [snapshot, ...(disposable ?? [])]);
  }
  isExistingOmnipolymathStateSchema(pathname);
}

function withOmnipolymathStateDatabaseReadOnlyIfOpen<T>(
  operation: (database: OmnipolymathStateReadOnlyDatabase) => T,
  pathname: string,
  currentAuthority = false,
): ReusedOmnipolymathStateReadOnlyDatabase<T> {
  const snapshot = stateSnapshotReads.getStore();
  if (snapshot?.active && snapshot.path === pathname) {
    omnipolymathStateDatabaseCache.assertOmnipolymathStateDatabaseFreshOpenAllowedAtPath(
      pathname,
      snapshot.env,
    );
    const source = snapshot.readSource();
    if (source) {
      return {
        reused: true,
        value: readRetainedStateSnapshot(snapshot, source, operation),
      };
    }
  }
  if (
    isArtifactPreservingStateRead("agent", pathname) &&
    (requiresArtifactPreservingSnapshot(pathname) ||
      isUpdateRehearsalPrivateDatabase(pathname, process.env))
  ) {
    return { reused: false };
  }
  if (isStatePostgres() && !currentAuthority) {
    return { reused: false };
  }
  return withCachedOmnipolymathStateDatabaseReadOnly(
    operation,
    pathname,
    currentAuthority || synchronousReadSnapshots.currentAuthorityPath === pathname,
  );
}

function withFreshOmnipolymathStateDatabaseReadOnly<T>(
  operation: (database: OmnipolymathStateReadOnlyDatabase) => T,
  options: OmnipolymathStateDatabaseOptions,
  pathname: string,
): T {
  const env = options.env ?? process.env;
  omnipolymathStateDatabaseCache.assertOmnipolymathStateDatabaseFreshOpenAllowedAtPath(pathname, env);
  if (synchronousReadSnapshots.currentAuthorityPath === pathname) {
    const maintained = withMaintenanceOmnipolymathStateDatabaseReadOnly(operation, pathname);
    if (maintained.reused) {
      return maintained.value;
    }
  }
  // Even read-only SQLite opens can create a missing WAL. The existing worker
  // snapshots committed WAL pages without touching source sidecars or caller-held locks.
  // One consistent snapshot per synchronous scope avoids mixed reads and duplicate copies.
  // Concurrent commits become visible in the next scope; this reader closes at scope end.
  const readers = synchronousReadSnapshots.current;
  if (readers && requiresArtifactPreservingSnapshot(pathname)) {
    let opened = readers.get(pathname);
    if (!opened) {
      opened = openOmnipolymathStateReadOnlyLocation(
        pathname,
        prepareSqliteReadOnlyLocationSync(pathname, undefined, REUSE_IMAGE),
      );
      readers.set(pathname, opened);
    }
    assertStateReadSchema(opened.database.db, pathname);
    const result = operation(opened.database);
    if (isPromiseLike(result)) {
      throw new SqliteCoordinatorError("SQLite metadata snapshot read must remain synchronous");
    }
    return result;
  }
  const prepared = requiresArtifactPreservingSnapshot(pathname)
    ? prepareSqliteReadOnlyLocationSync(pathname, undefined, REUSE_IMAGE)
    : undefined;
  // Maintenance must release readers before replacing store files.
  return withOmnipolymathStateReadOnlyLocation(
    operation,
    pathname,
    prepared ?? pathname,
    undefined,
    undefined,
    undefined,
    !isMainThread && !getOmnipolymathDatabaseMaintenanceScope(),
  );
}

/** Read shared state without joining writers; admission inherits artifact preservation. */
export function withOmnipolymathStateDatabaseReadOnly<T>(
  operation: (database: OmnipolymathStateReadOnlyDatabase) => T,
  options: OmnipolymathStateDatabaseOptions = {},
): T {
  const pathname = resolveOmnipolymathStateReadPath(options);
  // Reusing a handle this process already holds keeps row loops cheap: opening
  // and closing a connection per call made shared-state reads scale with row
  // count. An in-flight transaction is skipped so callers never observe
  // uncommitted rows a fresh read-only connection could not have seen.
  if (synchronousReadSnapshots.current?.has(pathname)) {
    return withFreshOmnipolymathStateDatabaseReadOnly(operation, options, pathname);
  }
  const reused = withOmnipolymathStateDatabaseReadOnlyIfOpen(operation, pathname);
  if (reused.reused) {
    return reused.value;
  }
  return withFreshOmnipolymathStateDatabaseReadOnly(operation, options, pathname);
}

/** A missing pathname is not absence while this read owner can serve retained state. */
export function isOmnipolymathStateDatabaseDefinitelyAbsent(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    const pathname = resolveOmnipolymathStateReadPath({ env });
    const snapshot = stateSnapshotReads.getStore();
    if (
      synchronousReadSnapshots.current?.has(pathname) ||
      (snapshot?.active && snapshot.path === pathname && snapshot.readSource()) ||
      omnipolymathStateDatabaseCache.getCachedOmnipolymathStateDatabase(pathname)?.db.isOpen
    ) {
      return false;
    }
    try {
      lstatSync(pathname);
      return false;
    } catch (error) {
      return hasErrnoCode(error, "ENOENT");
    }
  } catch {
    // Unknown availability retains the normal reader's admission and error behavior.
    return false;
  }
}

/** Read existing shared state while preserving non-missing filesystem failures. */
export function withExistingOmnipolymathStateDatabaseReadOnly<T>(
  operation: (database: OmnipolymathStateReadOnlyDatabase) => T,
  options: OmnipolymathStateDatabaseOptions = {},
): T | undefined {
  const pathname = resolveOmnipolymathStateReadPath(options);
  if (synchronousReadSnapshots.current?.has(pathname)) {
    return withFreshOmnipolymathStateDatabaseReadOnly(operation, options, pathname);
  }
  const reused = withOmnipolymathStateDatabaseReadOnlyIfOpen(operation, pathname);
  if (reused.reused) {
    return reused.value;
  }
  const existingPath = existingPathOrUndefined(pathname);
  return existingPath === undefined
    ? undefined
    : withFreshOmnipolymathStateDatabaseReadOnly(operation, options, existingPath);
}

/** Fixed reads observe committed state unless their owner explicitly selected a snapshot. */
export function executeExistingOmnipolymathStateRead<Command extends OmnipolymathStateReadCommand>(
  options: OmnipolymathStateDatabaseOptions,
  command: Command,
  readOptions: OmnipolymathStateReadOptions = {},
): Promise<StateReadReply<Command["type"]> | undefined> {
  const type = command.type;
  const { context, current, live, mapError } = readOptions;
  const receipt: OmnipolymathStateReadReceipt = { phase: "before-read" };
  let completion: OmnipolymathStateReadCompletion;
  try {
    context?.admission.assertCurrent();
    const execute = () => startRetainedOmnipolymathStateRead(options, command, receipt, readOptions);
    // Active writer observations use the retained worker connection, not a new
    // artifact-preserving copy. Admission and canonical close still own it.
    const read = live
      ? () => artifactPreservingReads.run(false, () => exitStateReadSnapshot(execute))
      : current
        ? () => exitStateReadSnapshot(execute)
        : execute;
    completion = runPluginSharedStateWork(() =>
      context?.runInCapturedSchemaScope ? context.runInCapturedSchemaScope(read) : read(),
    );
  } catch (error) {
    throw mapError ? mapError(error, receipt.phase) : error;
  }
  return completion.then((reply) => {
    if (!reply || isStateReadReply(reply, type)) {
      return reply;
    }
    throw new Error(`Unexpected shared-state read reply for ${type}`);
  });
}

function startRetainedOmnipolymathStateRead(
  options: OmnipolymathStateDatabaseOptions,
  command: OmnipolymathStateReadCommand,
  receipt: OmnipolymathStateReadReceipt,
  {
    context: capturedContext,
    signal,
    current,
    live,
    mapError,
    preferIndependentWarmRead,
    snapshotPreparation,
    onChunk,
    onChunkAsync,
  }: OmnipolymathStateReadOptions,
): OmnipolymathStateReadCompletion {
  const currentRead = current || live;
  const pathname = resolveOmnipolymathStateReadPath(options);
  const inherited = stateSnapshotReads.getStore();
  const snapshot = inherited?.active && inherited.path === pathname ? inherited : undefined;
  const scopes: RetainedReadScope[] = [
    ...(snapshot ? [snapshot] : []),
    ...(disposableStateReads.getStore() ?? []).filter(
      (scope) => scope.active && scope.path === pathname,
    ),
  ];
  const env = snapshot?.env ?? options.env;
  const context = capturedContext ?? captureOmnipolymathStateReadWorkerContext({ path: pathname, env });
  if (capturedContext) {
    if (context.admission.databasePath !== pathname) {
      throw new Error("Shared-state read context does not match its selected source");
    }
    context.maintenanceScope?.assertAdmission();
    context.admission.assertCurrent();
  }
  const preserveArtifacts = requiresArtifactPreservingSnapshot(pathname);
  const controller = new AbortController();
  // Inspection inherits its deadline; ordinary background reads own explicit cancellation.
  const callerSignal =
    signal ??
    (isArtifactPreservingStateRead() ? resolveStateReadCallerSignal() : snapshot?.callerSignal);
  const readSignal = callerSignal
    ? AbortSignal.any([callerSignal, controller.signal])
    : controller.signal;
  const run = () => {
    const inheritedSource = currentRead
      ? undefined
      : synchronousReadSnapshots.current?.get(pathname)?.snapshotSource?.retain();
    const start = () =>
      startOmnipolymathStateReadOperation(command, {
        pathname,
        snapshot: inheritedSource ?? snapshot?.readSource(),
        scopes,
        context,
        preserveArtifacts,
        preferIndependentWarmRead,
        snapshotPreparation,
        onChunk,
        onChunkAsync,
        controller,
        signal: readSignal,
        callerSignal,
        receipt,
        mapError,
      });
    if (snapshot?.prepareSource && !inheritedSource) {
      readSignal.throwIfAborted();
      return snapshot.prepareSource().then(
        () => {
          if (readSignal.aborted) {
            throw mapError ? mapError(readSignal.reason, receipt.phase) : readSignal.reason;
          }
          return start();
        },
        (error: unknown) => {
          throw mapError ? mapError(error, receipt.phase) : error;
        },
      );
    }
    return start();
  };
  // Enter the same frames as tracked async work, but keep its retained result independent
  // of the bookkeeping promises used by scope drains.
  const tracked = scopes.reduceRight<() => OmnipolymathStateReadCompletion>(
    (operation, scope) => () =>
      scope.work.run(() => {
        const completion = operation();
        void scope.work.track(() => completion).catch(() => undefined);
        return completion;
      }),
    run,
  );
  const maintenance = context.maintenanceScope;
  let completion: OmnipolymathStateReadCompletion | undefined;
  if (maintenance) {
    // Maintenance keeps this captured frame active until the callback's Promise settles.
    void maintenance.run(() => {
      const accepted = tracked();
      completion = accepted;
      return accepted;
    });
  } else {
    completion = tracked();
  }
  if (!completion) {
    throw new Error("Shared-state read maintenance scope did not start its operation");
  }
  void retainSnapshotWork(completion, () =>
    controller.abort(new Error("Shared-state read admission closed")),
  );
  return completion;
}

/** Read existing shared state without creating or updating its SQLite sidecars. */
export function withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnly<T>(
  operation: (database: OmnipolymathStateReadOnlyDatabase) => T,
  options: OmnipolymathStateDatabaseOptions = {},
  openStateSchemaReadAdmission?: OmnipolymathStateSchemaReadAdmission,
): T | undefined {
  if (openStateSchemaReadAdmission) {
    return withExistingOmnipolymathStateDatabaseCurrentReadOnly(
      operation,
      options,
      openStateSchemaReadAdmission,
    );
  }
  return withArtifactPreservingStateReads(() =>
    withExistingOmnipolymathStateDatabaseReadOnly(operation, options),
  );
}

/** Publication guards need current rows, never an inherited discovery snapshot. */
export function withExistingOmnipolymathStateDatabaseCurrentReadOnly<T>(
  operation: (database: OmnipolymathStateReadOnlyDatabase) => T,
  options: OmnipolymathStateDatabaseOptions & {
    /** Existing host mutation guards may read natively outside worker admission grants. */
    allowNativeRead?: true;
  } = {},
  openStateSchemaReadAdmission?: OmnipolymathStateSchemaReadAdmission,
): T | undefined {
  const pathname = resolveOmnipolymathStateReadPath(options);
  return exitStateReadSnapshot(() => {
    // Maintenance admission belongs to a fresh private reader, never a cached writer.
    if (!openStateSchemaReadAdmission) {
      const reused = withOmnipolymathStateDatabaseReadOnlyIfOpen(operation, pathname, true);
      if (reused.reused) {
        return reused.value;
      }
    }
    if (existingPathOrUndefined(pathname) === undefined) {
      return undefined;
    }
    omnipolymathStateDatabaseCache.assertOmnipolymathStateDatabaseFreshOpenAllowedAtPath(
      pathname,
      options.env ?? process.env,
    );
    const directRead =
      (isStatePostgres() || options.allowNativeRead || isLiveStateRead()) &&
      (!isArtifactPreservingStateRead() || isLiveStateRead()) &&
      // Admission still gets a fresh reader. Host guards repeat throughout an
      // update, so they must not copy the whole database for each check.
      (!openStateSchemaReadAdmission || options.allowNativeRead === true);
    if (!directRead) {
      assertStateFileSnapshotAllowed();
    }
    return withOmnipolymathStateReadOnlyLocation(
      operation,
      pathname,
      directRead ? pathname : prepareSqliteReadOnlyLocationSync(pathname, undefined, REUSE_IMAGE),
      openStateSchemaReadAdmission,
    );
  });
}

/** Preserve source artifacts while allowing the caller to progress during snapshot preparation. */
export function withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnlyAsync<T>(
  operation: (database: OmnipolymathStateReadOnlyDatabase) => T,
  options: OmnipolymathStateDatabaseOptions = {},
): Promise<T | undefined> {
  return withArtifactPreservingStateReads(async () => {
    const pathname = resolveOmnipolymathStateReadPath(options);
    const snapshot = stateSnapshotReads.getStore();
    if (snapshot?.path === pathname && snapshot.prepareSource) {
      return snapshot.work.track(async () => {
        await snapshot.prepareSource!();
        resolveStateReadCallerSignal()?.throwIfAborted();
        const reused = withEngineStoreAdmission(() =>
          withOmnipolymathStateDatabaseReadOnlyIfOpen(operation, pathname),
        );
        return reused.reused ? reused.value : undefined;
      });
    }
    const reused = withEngineStoreAdmission(() =>
      withOmnipolymathStateDatabaseReadOnlyIfOpen(operation, pathname),
    );
    if (reused.reused) {
      return reused.value;
    }
    if (existingPathOrUndefined(pathname) === undefined) {
      return undefined;
    }
    const env = options.env ?? process.env;
    omnipolymathStateDatabaseCache.assertOmnipolymathStateDatabaseFreshOpenAllowedAtPath(pathname, env);
    if (!requiresArtifactPreservingSnapshot(pathname)) {
      return withEngineStoreAdmission(() =>
        withOmnipolymathStateReadOnlyLocation(operation, pathname, pathname),
      );
    }
    const prepared = await prepareSqliteReadOnlyLocation(pathname, {
      preserveSourceArtifacts: true,
      reuse: true,
    });
    try {
      // Verification can quarantine the live path while the snapshot child is running.
      omnipolymathStateDatabaseCache.assertOmnipolymathStateDatabaseFreshOpenAllowedAtPath(pathname, env);
    } catch (error) {
      prepared.cleanup();
      throw error;
    }
    return withEngineStoreAdmission(() =>
      withOmnipolymathStateReadOnlyLocation(operation, pathname, prepared),
    );
  });
}

export function readCurrentOmnipolymathStateDatabaseContentVersion(
  options: OmnipolymathStateDatabaseOptions = {},
): string | undefined {
  const pathname = resolveOmnipolymathStateReadPath(options);
  const env = options.env ?? process.env;
  return exitStateReadSnapshot(() => readAdmittedStateContentVersion(pathname, env));
}

/** Current guards leave discovery snapshots after validating their inherited read admission. */
export function withCurrentOmnipolymathStateReadScope<T>(
  options: OmnipolymathStateDatabaseOptions,
  operation: (pathname: string) => T,
): T {
  const pathname = resolveOmnipolymathStateReadPath(options);
  return exitStateReadSnapshot(() => operation(pathname));
}
