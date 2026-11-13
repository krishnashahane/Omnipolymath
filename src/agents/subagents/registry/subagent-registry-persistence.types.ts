import type { createDeferredCore } from "../../../shared/deferred.js";
import type { OmnipolymathStateWorkerContext } from "../../../state/omnipolymath-state-worker-context.types.js";
import type { DomainScope } from "../../../state/omnipolymath-state-worker-store.types.js";
import type { SubagentRunMutation } from "./subagent-registry-mutation.types.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

export type SubagentRegistryWriteFailure = Error & {
  readonly outcome: "not-committed" | "committed" | "unknown";
  readonly publication?: "published" | "superseded";
};

export type PendingRegistryWrite = {
  runIds: ReadonlySet<string>;
  admission: OmnipolymathStateWorkerContext["admission"];
  settled: ReturnType<typeof createDeferredCore<void>>;
  uncertain?: SubagentRegistryWriteFailure;
  killClaim?: SubagentRunRecord;
  rekeys?: Array<{
    from: string;
    to: string;
    owner: object;
    sourceIdentity: string;
    destinationIdentity: string;
  }>;
};

export type RegistrySourceQueue = {
  admission: OmnipolymathStateWorkerContext["admission"];
  tails: Map<string, Promise<void>>;
  restore?: Promise<void>;
};

export type SubagentRegistryWriteAuthority = {
  assertCurrent: () => void;
  assertDatabase: () => void;
};

export type SubagentRunMutationOptions<P extends SubagentRunMutation<unknown>> = {
  runs?: Map<string, SubagentRunRecord>;
  preparedRows?: () => ReadonlyMap<string, SubagentRunRecord>;
  context?: OmnipolymathStateWorkerContext;
  assertCurrent?: () => void;
  pendingKillClaim?: SubagentRunRecord;
  onPublished?: (
    postimages: ReadonlyMap<string, SubagentRunRecord | null>,
    value: P["value"],
  ) => void;
  commit?: (
    planned: P,
    authority: SubagentRegistryWriteAuthority,
  ) => Promise<SubagentRunMutation<P["value"]>>;
};

export type SubagentRegistryWorkerWrite<T> = {
  writeId: string;
  assertCurrent: () => void;
} & (
  | {
      kind: "registry";
      execute: (scope: DomainScope) => Promise<unknown>;
      decode: (value: unknown) => T;
      terminalEvents: SubagentRunMutation<unknown>["terminalEvents"];
    }
  | {
      kind: "completion";
      execute: (scope: DomainScope) => Promise<T>;
      decodeCommitted: (value: unknown) => T;
    }
);
