import type { OmnipolymathStateDatabaseOptions } from "../state/omnipolymath-state-db-contract.js";
import type { OmnipolymathStateWorkerLeaseContext } from "../state/omnipolymath-state-lease-context.js";
import type { OmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.types.js";

export type TemplateMutationStateOptions = OmnipolymathStateDatabaseOptions & {
  stateMode?: "worker";
  assertCurrent?: () => void;
  prepareEffect?: () => Promise<void>;
  leaseSet?: {
    context: OmnipolymathStateWorkerContext;
    leases: readonly OmnipolymathStateWorkerLeaseContext[];
  };
};
