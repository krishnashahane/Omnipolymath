import type { captureRuntimeWorkerSource } from "../infra/runtime-worker-generation.js";
import type { SqliteWorkerAdmissionCleanup } from "../infra/sqlite-worker-broker.types.js";
import type {
  getSqliteWorkerActorIdentity,
  SqliteWorkerStore,
} from "../infra/sqlite-worker-store.js";
import type { OmnipolymathStateWorkerContext } from "./omnipolymath-state-worker-context.types.js";
import type { OmnipolymathStateWorkerOperations } from "./omnipolymath-state-worker-contract.js";

export type Store = SqliteWorkerStore<OmnipolymathStateWorkerOperations>;
export type DomainScope = Pick<SqliteWorkerStore<OmnipolymathStateWorkerOperations>, "execute">;
export type IdleTimer = ReturnType<typeof setTimeout> & { unref?: () => void };
export type Entry = {
  source: ReturnType<typeof captureRuntimeWorkerSource>;
  context: OmnipolymathStateWorkerContext;
  opening: Promise<Store | undefined>;
  existingOnly: boolean;
  store?: Store;
  actor?: ReturnType<typeof getSqliteWorkerActorIdentity>;
  bound?: boolean;
  cleanup?: SqliteWorkerAdmissionCleanup;
  nativeLostListeners: Set<() => void>;
  activeOperations: number;
  idleTimer?: IdleTimer;
};
