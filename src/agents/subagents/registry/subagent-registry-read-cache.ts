import { expectDefined } from "@omnipolymath/normalization-core";
import { isPromiseLike } from "@omnipolymath/normalization-core/promise-like";
import { isVitestRuntimeEnv } from "../../../infra/env.js";
import { getAsyncWorkSignal } from "../../../shared/async-work-scope.js";
import {
  isStateDatabaseReadAdmissionInvalidatedError,
  type OmnipolymathStateDatabaseReadAdmission,
} from "../../../state/omnipolymath-state-db-async-lifecycle.js";
import {
  captureOmnipolymathStateDatabaseReadAdmission,
  omnipolymathStateDatabaseCache,
} from "../../../state/omnipolymath-state-db-cache.js";
import {
  executeExistingOmnipolymathStateRead,
  getActiveOmnipolymathStateDatabaseReadSnapshot,
} from "../../../state/omnipolymath-state-db-readonly.js";
import { resolveOmnipolymathStateSqlitePath } from "../../../state/omnipolymath-state-db.paths.js";
import type { OmnipolymathStateReadCommand } from "../../../state/omnipolymath-state-read.types.js";
import {
  captureOmnipolymathStateReadContext,
  captureOmnipolymathStateWorkerContext,
  type OmnipolymathStateReadContext,
} from "../../../state/omnipolymath-state-worker-context.js";
import type { OmnipolymathStateWorkerContext } from "../../../state/omnipolymath-state-worker-context.types.js";
import {
  hydrateOmnipolymathStateWorkerError,
  retainOmnipolymathStateWorkerErrorPayload,
} from "../../../state/omnipolymath-state-worker-error.js";
import {
  freezeSubagentRunReadRecord,
  getSubagentSessionReadLookup,
  immutableSubagentRun,
  restoreSubagentRunPayload,
} from "./subagent-registry-memory.js";
import type { SubagentRunReadRecord } from "./subagent-registry-read.types.js";
import { readAllSubagentRunsInWorker } from "./subagent-registry.store.read.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";
import { isSubagentRunPayloadEvicted } from "./subagent-run-payload-facts.js";
import { SubagentSessionReadLookup } from "./subagent-session-read-scope.js";

type SubagentRunChange<T> = { entry: T | undefined };

type SubagentRunsCacheState<T extends SubagentRunReadRecord> = (
  | {
      snapshot: Map<string, T>;
      lookup?: SubagentSessionReadLookup;
      changes?: never;
    }
  | {
      snapshot?: undefined;
      lookup?: never;
      changes?: Map<string, SubagentRunChange<T>>;
    }
) & {
  admission?: OmnipolymathStateDatabaseReadAdmission;
  sourceIdentity?: string;
  pending?: {
    promise: Promise<void>;
    changes?: Map<string, SubagentRunChange<T>>;
    replacement?: Map<string, T>;
  };
};

export type SubagentRunsCache<T extends SubagentRunReadRecord> = {
  state: SubagentRunsCacheState<T>;
  copy: (entry: SubagentRunRecord) => T | undefined;
  project: (entry: SubagentRunRecord) => T;
};

export function getSessionListLookup<T extends SubagentRunReadRecord>(
  cache: SubagentRunsCache<T>,
  snapshot: Map<string, T>,
): SubagentSessionReadLookup {
  const state = cache.state;
  if (state.snapshot !== snapshot) {
    return new SubagentSessionReadLookup(snapshot);
  }
  return (state.lookup ??= new SubagentSessionReadLookup(snapshot));
}

export function indexedSnapshotRows<T>(snapshot: Map<string, T>, keys: readonly string[]): T[] {
  return keys.map((key) => expectDefined(snapshot.get(key), "indexed subagent cache entry"));
}

export function shouldReadPersistedSubagentRuns(): boolean {
  return !isVitestRuntimeEnv() || process.env.OMNIPOLYMATH_TEST_READ_SUBAGENT_RUNS_FROM_SQLITE === "1";
}

function captureSubagentFactsAdmission(databasePath = resolveOmnipolymathStateSqlitePath()) {
  return captureOmnipolymathStateDatabaseReadAdmission(databasePath);
}

function matchesSubagentCacheAdmission(
  previous: OmnipolymathStateDatabaseReadAdmission | undefined,
  current: OmnipolymathStateDatabaseReadAdmission,
): boolean {
  if (!previous) {
    return true;
  }
  if (previous.identity.key !== current.identity.key) {
    return false;
  }
  try {
    previous.assertCurrent();
    return true;
  } catch {
    return false;
  }
}

function setOrDeleteRun<T extends SubagentRunReadRecord>(
  runs: Map<string, T>,
  runId: string,
  entry: T | undefined,
): void {
  if (entry) {
    runs.set(runId, entry);
  } else {
    runs.delete(runId);
  }
}

function applySubagentRunChanges<T extends SubagentRunReadRecord>(
  runs: Map<string, T>,
  changes: Map<string, SubagentRunChange<T>> | undefined,
): Map<string, T> {
  for (const [runId, { entry }] of changes ?? []) {
    setOrDeleteRun(runs, runId, entry);
  }
  return runs;
}

/** Selecting a read must not consume another database owner's publication. */
export function selectSubagentCacheStateForRead<T extends SubagentRunReadRecord>(
  state: SubagentRunsCacheState<T>,
  context?: Pick<OmnipolymathStateReadContext, "admission">,
): SubagentRunsCacheState<T> {
  const identity = state.admission?.identity;
  const matches = context
    ? matchesSubagentCacheAdmission(state.admission, context.admission) &&
      (state.sourceIdentity === undefined ||
        state.sourceIdentity === context.admission.identity.key)
    : !identity ||
      identity ===
        omnipolymathStateDatabaseCache.getKnownOmnipolymathStateDatabaseIdentity(
          resolveOmnipolymathStateSqlitePath(),
        );
  return matches ? state : {};
}

export function rememberSubagentRunsSnapshot<T extends SubagentRunReadRecord>(
  cache: SubagentRunsCache<T>,
  runs: Map<string, SubagentRunRecord>,
  changedRunIds: readonly string[] | undefined,
  databasePath?: string,
): void {
  let admission: OmnipolymathStateDatabaseReadAdmission;
  try {
    admission = captureSubagentFactsAdmission(databasePath);
  } catch (error) {
    if (!isStateDatabaseReadAdmissionInvalidatedError(error)) {
      throw error;
    }
    // The write is committed; a closing reader can reload it after reopening.
    cache.state = {};
    return;
  }
  const previous = selectSubagentCacheStateForRead(cache.state, { admission });
  const owner = {
    admission,
    sourceIdentity: admission.identity.key,
    pending: previous.pending,
  };
  if (previous.pending?.changes && changedRunIds) {
    for (const runId of changedRunIds) {
      const entry = runs.get(runId);
      previous.pending.changes.set(runId, { entry: entry ? cache.copy(entry) : undefined });
    }
  }
  const snapshot = previous.snapshot;
  if (!changedRunIds) {
    const replacement = new Map<string, T>();
    for (const [runId, entry] of runs) {
      setOrDeleteRun(replacement, runId, cache.copy(entry));
    }
    if (previous.pending?.changes) {
      previous.pending.replacement = replacement;
      previous.pending.changes.clear();
    }
    cache.state = {
      snapshot: replacement,
      ...owner,
    };
    return;
  }
  if (!snapshot) {
    // Until the first full read, named writes cannot account for durable-only rows.
    const changes = previous.changes ?? new Map<string, SubagentRunChange<T>>();
    for (const runId of changedRunIds) {
      const entry = runs.get(runId);
      changes.set(runId, { entry: entry ? cache.copy(entry) : undefined });
    }
    cache.state = {
      changes,
      ...owner,
    };
    return;
  }
  const lookup = previous.lookup;
  // A failed projection/update cannot leave derived membership ahead of its Map.
  previous.lookup = undefined;
  for (const runId of new Set(changedRunIds)) {
    const entry = runs.get(runId);
    setOrDeleteRun(snapshot, runId, entry ? cache.copy(entry) : undefined);
    lookup?.set(runId, snapshot.get(runId));
  }
  cache.state = {
    snapshot,
    ...owner,
    ...(lookup ? { lookup } : {}),
  };
}

export function getPersistedSubagentRunsSnapshot<T extends SubagentRunReadRecord>(
  cache: SubagentRunsCache<T>,
  prepared?: OmnipolymathStateReadContext,
): Map<string, T> | null {
  const context = prepared ?? captureOmnipolymathStateReadContext();
  context.maintenanceScope?.assertAdmission();
  const admission = context.admission;
  if (selectSubagentCacheStateForRead(cache.state, context) !== cache.state) {
    if (!prepared) {
      cache.state = { admission, sourceIdentity: admission.identity.key };
    }
    return null;
  }
  return cache.state.pending ? null : (cache.state.snapshot ?? null);
}

export function loadPersistedSubagentRunsForRead<T extends SubagentRunReadRecord>(
  cache: SubagentRunsCache<T>,
  prepared?: OmnipolymathStateReadContext,
): Map<string, T> {
  const cached = getPersistedSubagentRunsSnapshot(cache, prepared);
  if (cached) {
    return cached;
  }
  throw new Error("Subagent registry facts must be prepared before synchronous reads");
}

export function assertSubagentReadContext(context: OmnipolymathStateWorkerContext): void {
  getAsyncWorkSignal()?.throwIfAborted();
  context.maintenanceScope?.assertAdmission();
  context.admission.assertCurrent();
}

export function getSubagentRunsSnapshot<T extends SubagentRunReadRecord>(
  inMemoryRuns: Map<string, SubagentRunRecord>,
  cache: SubagentRunsCache<T>,
  scope?: {
    context?: OmnipolymathStateReadContext;
    load?: () => Iterable<T>;
    liveRunIds?: ReadonlySet<string>;
    matches: (entry: SubagentRunReadRecord) => boolean;
  },
): Map<string, T> {
  const merged = new Map<string, T>();
  if (shouldReadPersistedSubagentRuns()) {
    const cached = loadPersistedSubagentRunsForRead(cache, scope?.context);
    const persisted = scope?.load ? scope.load() : cached.values();
    for (const entry of persisted) {
      if (!scope || scope.matches(entry)) {
        merged.set(entry.runId, entry);
      }
    }
    const state = selectSubagentCacheStateForRead(cache.state, scope?.context);
    for (const [runId, { entry }] of state.changes ?? []) {
      setOrDeleteRun(merged, runId, entry && (!scope || scope.matches(entry)) ? entry : undefined);
    }
  }
  for (const [runId, entry] of scope?.liveRunIds
    ? selectedEntries(inMemoryRuns, scope.liveRunIds)
    : inMemoryRuns) {
    // Live memory wins even when a run moved out of the persisted scope.
    setOrDeleteRun(
      merged,
      runId,
      !scope || scope.matches(entry) ? cache.project(entry) : undefined,
    );
  }
  return merged;
}

export class SubagentSessionListUnavailableError extends Error {}

export async function readCompactSubagentRuns(context: OmnipolymathStateWorkerContext) {
  const reply = await executeExistingOmnipolymathStateRead(
    { path: context.admission.databasePath, env: context.environment },
    { type: "subagents.sessionList" },
    { context },
  );
  if (!reply) {
    return new Map<string, SubagentRunReadRecord>();
  }
  if ("unavailable" in reply) {
    const failure = new Error(reply.unavailable.message);
    retainOmnipolymathStateWorkerErrorPayload(failure, reply.unavailable.error);
    throw new SubagentSessionListUnavailableError(reply.unavailable.message, {
      cause: hydrateOmnipolymathStateWorkerError(failure, { includeOrdinary: true }),
    });
  }
  reply.runs.forEach(freezeSubagentRunReadRecord);
  return reply.runs;
}

export async function readFullSubagentRuns(
  context: OmnipolymathStateWorkerContext,
  scope: Extract<OmnipolymathStateReadCommand, { type: "subagents.runs" }>["scope"],
  options: { current?: boolean } = {},
) {
  if (scope.kind === "ids" && scope.runIds.length === 0) {
    return new Map<string, SubagentRunRecord>();
  }
  const reply = await executeExistingOmnipolymathStateRead(
    { path: context.admission.databasePath, env: context.environment },
    { type: "subagents.runs", scope },
    options.current ? { context, current: true } : undefined,
  );
  if (!reply) {
    return new Map<string, SubagentRunRecord>();
  }
  if (!reply.ok || reply.type !== "subagents.runs" || reply.projection === "maintenance") {
    throw new Error("Unexpected subagent registry read result");
  }
  for (const entry of reply.runs.values()) {
    immutableSubagentRun(entry);
  }
  return reply.runs;
}

export async function prepareSubagentRunsCache<T extends SubagentRunReadRecord>(
  cache: SubagentRunsCache<T>,
  load: (context: OmnipolymathStateWorkerContext) => Promise<Map<string, T>>,
  prepared?: OmnipolymathStateWorkerContext,
): Promise<Map<string, T>> {
  const context = prepared ?? captureOmnipolymathStateWorkerContext();
  // Admission adopts a newly created file; cached bytes still belong to the original source.
  const sourceIdentity = context.admission.identity.key;
  if (
    getActiveOmnipolymathStateDatabaseReadSnapshot({
      path: context.admission.databasePath,
      env: context.environment,
    })
  ) {
    // Private snapshot bytes never become canonical resident facts.
    return load(context);
  }
  const state = selectSubagentCacheStateForRead(cache.state, context);
  if (state !== cache.state) {
    cache.state = state;
  }
  if (state.snapshot && !state.pending) {
    return state.snapshot;
  }
  if (!state.pending) {
    state.admission = context.admission;
    state.sourceIdentity = sourceIdentity;
    state.pending = {
      promise: Promise.resolve().then(async () => {
        const runs = await load(context);
        // Committed local publications win over an older worker snapshot.
        if (!cache.state.snapshot) {
          cache.state = {
            snapshot: applySubagentRunChanges(runs, cache.state.changes),
            admission: context.admission,
            sourceIdentity,
          };
        }
      }),
    };
  }
  const fill = state.pending;
  try {
    // Shared fill failures propagate; the next request retries.
    await fill.promise;
    return expectDefined(cache.state.snapshot, "prepared subagent registry snapshot");
  } finally {
    if (cache.state.pending === fill) {
      cache.state.pending = undefined;
    }
  }
}

/** Apply local commits made during restore before publishing the durable rows. */
export async function consumeFreshSubagentRuns<T>(
  cache: SubagentRunsCache<SubagentRunRecord>,
  context: OmnipolymathStateWorkerContext,
  consume: (runs: Map<string, SubagentRunRecord>) => T,
): Promise<T> {
  while (cache.state.pending) {
    await cache.state.pending.promise;
  }
  const previous = selectSubagentCacheStateForRead(cache.state, context);
  const state = {
    ...previous,
    admission: captureSubagentFactsAdmission(context.admission.databasePath),
    sourceIdentity: context.admission.identity.key,
  };
  cache.state = state;
  let result: T;
  const fill: NonNullable<SubagentRunsCacheState<SubagentRunRecord>["pending"]> = {
    changes: new Map(),
    promise: Promise.resolve().then(async () => {
      const loaded = await readAllSubagentRunsInWorker(context);
      assertSubagentReadContext(context);
      const runs = applySubagentRunChanges(fill.replacement ?? loaded, fill.changes);
      result = consumeSubagentRuns(runs, () => consume(runs));
    }),
  };
  state.pending = fill;
  try {
    await fill.promise;
    return result!;
  } finally {
    if (cache.state.pending === fill) {
      cache.state.pending = undefined;
    }
  }
}

export function acceptedFullSnapshot(
  cache: SubagentRunsCache<SubagentRunRecord>,
  context: OmnipolymathStateWorkerContext,
) {
  const state = selectSubagentCacheStateForRead(cache.state, context);
  return !getActiveOmnipolymathStateDatabaseReadSnapshot({
    path: context.admission.databasePath,
    env: context.environment,
  })
    ? state.snapshot
    : undefined;
}

export function consumeSubagentRuns<T>(
  runs: Map<string, SubagentRunRecord>,
  consume: (runs: ReadonlyMap<string, SubagentRunRecord>) => T,
): T {
  getAsyncWorkSignal()?.throwIfAborted();
  const result = consume(runs);
  if (isPromiseLike(result)) {
    void Promise.resolve(result).catch(() => {});
    throw new Error("Subagent registry read consumers must remain synchronous");
  }
  return result;
}

export function mergeSelectedFullRuns(
  cache: SubagentRunsCache<SubagentRunRecord>,
  inMemoryRuns: Map<string, SubagentRunRecord>,
  persisted: Map<string, SubagentRunRecord>,
  matches: (entry: SubagentRunReadRecord) => boolean,
  {
    context,
    runIds,
    select,
    freshPersisted = false,
  }: {
    context?: OmnipolymathStateWorkerContext;
    runIds?: ReadonlySet<string>;
    select?: (
      lookup: SubagentSessionReadLookup,
      additionalKeys: readonly string[],
    ) => readonly string[];
    freshPersisted?: boolean;
  } = {},
): Map<string, SubagentRunRecord> {
  const current = context && !freshPersisted ? acceptedFullSnapshot(cache, context) : undefined;
  const merged = new Map<string, SubagentRunRecord>();
  const withPayload = (entry: SubagentRunRecord) => {
    const payload = persisted.get(entry.runId);
    return isSubagentRunPayloadEvicted(entry) && payload && !isSubagentRunPayloadEvicted(payload)
      ? restoreSubagentRunPayload(entry, payload)
      : entry;
  };
  const durable = current ?? persisted;
  for (const [runId, entry] of selectedEntries(
    durable,
    select ? select(getSessionListLookup(cache, durable), []) : runIds,
  )) {
    if (matches(entry)) {
      merged.set(runId, withPayload(entry));
    }
  }
  const state = selectSubagentCacheStateForRead(cache.state, context);
  if (
    context &&
    !freshPersisted &&
    !getActiveOmnipolymathStateDatabaseReadSnapshot({
      path: context.admission.databasePath,
      env: context.environment,
    })
  ) {
    for (const [runId, { entry }] of state.changes ? selectedEntries(state.changes, runIds) : []) {
      setOrDeleteRun(merged, runId, entry && matches(entry) ? withPayload(entry) : undefined);
    }
  }
  for (const [runId, entry] of selectedEntries(
    inMemoryRuns,
    // Include durable members so a live ownership move still vetoes their old scope.
    select ? select(getSubagentSessionReadLookup(inMemoryRuns), [...merged.keys()]) : runIds,
  )) {
    setOrDeleteRun(merged, runId, matches(entry) ? withPayload(entry) : undefined);
  }
  return merged;
}

function* selectedEntries<T>(
  rows: ReadonlyMap<string, T>,
  runIds?: Iterable<string>,
): Iterable<[string, T]> {
  if (!runIds) {
    yield* rows;
    return;
  }
  for (const runId of runIds) {
    const entry = rows.get(runId);
    if (entry !== undefined) {
      yield [runId, entry];
    }
  }
}
