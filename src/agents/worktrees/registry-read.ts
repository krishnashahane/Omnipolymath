import {
  executeExistingOmnipolymathStateRead,
  withOmnipolymathStateDatabaseReadSnapshot,
} from "../../state/omnipolymath-state-db-readonly.js";
import type { RegisteredStateReadCommand } from "../../state/omnipolymath-state-read-operation-registry.js";
import { captureOmnipolymathStateReadWorkerContext } from "../../state/omnipolymath-state-worker-context.js";
import type { OmnipolymathStateWorkerContext } from "../../state/omnipolymath-state-worker-context.types.js";
import { registryAuthorityChanged, WorktreeRecordNotFoundError } from "./errors.js";
import type { WorktreeRegistryListOptions } from "./registry-read.kernel.js";
import {
  captureWorktreeRegistryAuthority,
  captureWorktreeRunEndContext,
  type WorktreeRegistryChange,
  type WorktreeRegistryField,
  worktreeOwnerSelectionKey,
  WORKTREE_UNKNOWN_OWNER_SELECTION,
} from "./run-end-lifecycle.js";
import type {
  CreateManagedWorktreeParams,
  ManagedWorktreeOwnerKind,
  ManagedWorktreeRecord,
  ProvisionedFileState,
  WorktreeRegistryPredicate,
  WorktreeWorkerAuthority,
} from "./types.js";

type RowGuardKind = WorktreeRegistryPredicate["kind"] | "lifecycle" | "publication";
type WorktreeRegistrySelection = Pick<ManagedWorktreeRecord, "id" | "ownerKind" | "ownerId">;

export async function readWorktreeRegistryCommand<
  Command extends Extract<RegisteredStateReadCommand, { type: `worktrees.${string}` }>,
>(
  context: OmnipolymathStateWorkerContext,
  command: Command,
  signal?: AbortSignal,
): ReturnType<typeof executeExistingOmnipolymathStateRead<Command>> {
  const reply = await executeExistingOmnipolymathStateRead<Command>(
    { env: context.environment, path: context.admission.databasePath },
    command,
    { context, current: true, signal, preferIndependentWarmRead: true },
  );
  context.admission.assertCurrent();
  return reply;
}

function predicateFields(kind: RowGuardKind): readonly WorktreeRegistryField[] {
  switch (kind) {
    case "activity":
      return ["activity", "identity"];
    case "removal-claim":
    case "removal-claims":
      return ["leases"];
    case "session-owner":
    case "projection":
      return ["identity"];
    case "source-record":
      return ["identity", "fingerprint"];
    case "source-owner":
    case "lifecycle":
      return ["identity", "removal"];
    case "publication":
    case "live-binding":
      return ["identity", "fingerprint", "removal"];
    case "exact-owner":
      return ["identity", "activity", "removal"];
    case "binding":
      return ["identity", "fingerprint", "activity", "removal"];
    case "exact-snapshot":
      return ["identity", "fingerprint", "activity", "removal", "snapshot"];
    case "record":
      return ["identity", "fingerprint", "activity", "removal", "snapshot", "cleanup"];
    case "snapshot-retirement":
      return [
        "identity",
        "fingerprint",
        "activity",
        "removal",
        "snapshot",
        "cleanup",
        "provisioned",
        "leases",
      ];
  }
  throw new Error(`Unknown worktree predicate: ${String(kind satisfies never)}`);
}

function predicateRevisions(predicate: WorktreeRegistryPredicate): WorktreeRegistryChange[] {
  const fields = predicateFields(predicate.kind);
  const ids =
    predicate.kind === "removal-claims"
      ? predicate.ids
      : ["record" in predicate ? predicate.record.id : predicate.id];
  return [
    ...ids.map((id) => ({ id, fields })),
    ...(predicate.kind === "source-owner"
      ? [
          {
            id: worktreeOwnerSelectionKey("session", predicate.ownerId),
            fields: ["identity"] as const,
          },
          { id: WORKTREE_UNKNOWN_OWNER_SELECTION, fields: ["identity"] as const },
        ]
      : []),
  ];
}

/** Known selections stay scoped while the read is in flight; discovery narrows after the read. */
export function captureWorktreeRegistryReadGuard(
  context: OmnipolymathStateWorkerContext,
  kind:
    | "publication"
    | "binding"
    | "record"
    | "exact-snapshot"
    | "exact-owner"
    | "session-owner"
    | "source-record"
    | "projection"
    | "source-owner"
    | "lifecycle",
  selection?: WorktreeRegistrySelection,
): (record: WorktreeRegistrySelection | undefined) => () => void {
  const fields = predicateFields(kind);
  const changes = (record: WorktreeRegistrySelection): WorktreeRegistryChange[] => [
    { id: record.id, fields },
    ...((kind === "source-owner" || kind === "publication") && record.ownerId !== undefined
      ? [
          {
            id: worktreeOwnerSelectionKey(record.ownerKind, record.ownerId),
            fields: ["identity"] as const,
          },
          { id: WORKTREE_UNKNOWN_OWNER_SELECTION, fields: ["identity"] as const },
        ]
      : []),
  ];
  const assertRead = captureWorktreeRegistryAuthority(
    context,
    selection ? changes(selection) : [{ id: "*", fields }],
  );
  const verify = (assertCurrent: () => void) => {
    try {
      assertCurrent();
    } catch {
      throw registryAuthorityChanged(kind);
    }
  };
  return (record) => {
    context.admission.assertCurrent();
    verify(assertRead);
    const assertRow = record
      ? captureWorktreeRegistryAuthority(context, changes(record))
      : assertRead;
    return () => {
      context.admission.assertCurrent();
      verify(assertRow);
    };
  };
}

/** One exact-row read prepares a SQL-free guard retained through filesystem and Git waits. */
export async function prepareWorktreeRegistryGuard(
  context: OmnipolymathStateWorkerContext,
  authority: WorktreeWorkerAuthority,
): Promise<() => void> {
  const predicates = authority.predicates ?? [];
  const assertCaller = authority.assertCurrent;
  const generations = predicates.map((predicate) => ({
    kind: predicate.kind,
    assertCurrent: captureWorktreeRegistryAuthority(context, predicateRevisions(predicate)),
  }));
  const assertCurrent = () => {
    context.admission.assertCurrent();
    assertCaller?.();
    for (const generation of generations) {
      try {
        generation.assertCurrent();
      } catch {
        throw registryAuthorityChanged(generation.kind);
      }
    }
  };
  assertCurrent();
  if (predicates.length > 0) {
    const { executeOmnipolymathStateWorker } =
      await import("../../state/omnipolymath-state-worker-store.js");
    await executeOmnipolymathStateWorker(context, {
      type: "worktrees.assertPredicates",
      input: { predicates },
    });
    assertCurrent();
  }
  return assertCurrent;
}

export async function readLiveRegistryWorktreeByOwner(
  context: OmnipolymathStateWorkerContext,
  ownerKind: ManagedWorktreeOwnerKind,
  ownerId: string,
): Promise<ManagedWorktreeRecord | undefined> {
  return (
    await readWorktreeRegistryCommand(context, {
      type: "worktrees.findLiveByOwner",
      input: { ownerKind, ownerId },
    })
  )?.value;
}

export async function readRegistryWorktree(
  context: OmnipolymathStateWorkerContext,
  id: string,
): Promise<ManagedWorktreeRecord | undefined> {
  return (await readWorktreeRegistryCommand(context, { type: "worktrees.get", input: { id } }))
    ?.value;
}

export async function readSessionWorktreeBinding(
  context: OmnipolymathStateWorkerContext,
  boundId: string | undefined,
  ownerId: string,
): Promise<ManagedWorktreeRecord | undefined> {
  return (
    await readWorktreeRegistryCommand(context, {
      type: "worktrees.sessionBinding",
      input: { boundId, ownerId },
    })
  )?.value;
}

export async function readLiveRegistryWorktreeByPath(
  context: OmnipolymathStateWorkerContext,
  path: string,
): Promise<ManagedWorktreeRecord | undefined> {
  return (
    await readWorktreeRegistryCommand(context, {
      type: "worktrees.findLiveByPath",
      input: { path },
    })
  )?.value;
}

/** Resolve the exact target before lock admission without borrowing Gateway-thread SQLite. */
export async function readRegistryWorktreeForMutation(
  params: { env: NodeJS.ProcessEnv; id: string } & Pick<
    CreateManagedWorktreeParams,
    "signal" | "commitGuard"
  >,
): Promise<ManagedWorktreeRecord | undefined> {
  const assertCurrent = () => {
    params.signal?.throwIfAborted();
    params.commitGuard?.();
  };
  assertCurrent();
  const record = await readRegistryWorktree(captureWorktreeRunEndContext(params.env), params.id);
  assertCurrent();
  return record;
}

export function requireActiveWorktreeRecord(
  id: string,
  record: ManagedWorktreeRecord | undefined,
): ManagedWorktreeRecord {
  if (!record || record.removedAt !== undefined) {
    throw new WorktreeRecordNotFoundError(`unknown active worktree: ${id}`);
  }
  return record;
}

export async function readRegistryWorktrees(
  env: NodeJS.ProcessEnv,
  options: WorktreeRegistryListOptions = {},
  context: OmnipolymathStateWorkerContext = captureWorktreeRunEndContext(env),
): Promise<ManagedWorktreeRecord[]> {
  return (
    (await readWorktreeRegistryCommand(context, { type: "worktrees.list", input: options }))
      ?.value ?? []
  );
}

export async function readLiveRegistryWorktreeIds(env: NodeJS.ProcessEnv): Promise<string[]> {
  const context = captureWorktreeRunEndContext(env);
  return (
    (await readWorktreeRegistryCommand(context, { type: "worktrees.liveIds", input: undefined }))
      ?.value ?? []
  );
}

export async function getRegistryWorktreeProvisionedPaths(
  env: NodeJS.ProcessEnv,
  id: string,
): Promise<string[] | undefined> {
  return (
    await readWorktreeRegistryCommand(captureWorktreeRunEndContext(env), {
      type: "worktrees.provisionedPaths",
      input: { id },
    })
  )?.value;
}

export async function getRegistryWorktreeProvisionedState(
  env: NodeJS.ProcessEnv,
  id: string,
): Promise<ProvisionedFileState[] | undefined> {
  return (
    await readWorktreeRegistryCommand(captureWorktreeRunEndContext(env), {
      type: "worktrees.provisionedState",
      input: { id },
    })
  )?.value;
}

export async function getRegistryWorktreeProvisionedChunk(
  env: NodeJS.ProcessEnv,
  params: { worktreeId: string; path: string; chunkIndex: number },
): Promise<Uint8Array | undefined> {
  return (
    await readWorktreeRegistryCommand(captureWorktreeRunEndContext(env), {
      type: "worktrees.provisionedChunk",
      input: params,
    })
  )?.value;
}

export async function readWorktreeCleanupState(env: NodeJS.ProcessEnv) {
  const reply = await executeExistingOmnipolymathStateRead(
    { env },
    { type: "worktrees.cleanupState" },
    { current: true },
  );
  return reply ?? { records: [], leases: { liveScopes: [], staleScopes: [] } };
}

/** Foreign CLI inspection never admits a writer or repairs lifecycle state. */
export async function readExistingRegistryWorktrees(env: NodeJS.ProcessEnv, signal?: AbortSignal) {
  const context = captureOmnipolymathStateReadWorkerContext({ env });
  return (
    (await readWorktreeRegistryCommand(context, { type: "worktrees.list", input: {} }, signal))
      ?.value ?? []
  );
}

/** Discovery keeps pending publication and live rows in one SQLite or PostgreSQL snapshot. */
export async function readExistingWorktreePaths(env: NodeJS.ProcessEnv): Promise<string[]> {
  return withOmnipolymathStateDatabaseReadSnapshot(
    async () => {
      // Current/live reads leave discovery snapshots and can miss a slot as it publishes.
      const [live, pending] = await Promise.all([
        executeExistingOmnipolymathStateRead(
          { env },
          { type: "worktrees.livePaths", input: undefined },
        ),
        executeExistingOmnipolymathStateRead(
          { env },
          { type: "worktrees.pendingSlots", input: undefined },
        ),
      ]);
      return [
        ...new Set([
          ...(live?.value ?? []),
          ...(pending?.records ?? []).map(({ record }) => record.path),
        ]),
      ];
    },
    { env },
  );
}
