import type { OmnipolymathStateWorkerLeaseContext } from "./omnipolymath-state-lease-context.js";
import {
  withOmnipolymathStateLeaseWorkerAdmission,
  withOmnipolymathStateLeasesWorkerAdmission,
  type OmnipolymathStateLeaseWorkerAuthority,
} from "./omnipolymath-state-lease-worker-owner.js";
import { prepareOmnipolymathStateLeaseStorageRuntime } from "./omnipolymath-state-lease-worker-storage.js";
import type { OmnipolymathStateLeaseIdentity } from "./omnipolymath-state-lease.types.js";
import type { OmnipolymathStateWorkerContext } from "./omnipolymath-state-worker-context.types.js";
import type { DomainScope } from "./omnipolymath-state-worker-store.types.js";

/** Both importers must resolve their transport before package replacement. */
export async function prepareOmnipolymathStateLeaseWorkerRuntime(): Promise<void> {
  await Promise.all([
    prepareOmnipolymathStateLeaseStorageRuntime(),
    import("./omnipolymath-state-worker-store.js"),
  ]);
}

/** Retain the actual lease until every admitted worker transaction has settled. */
export function runWithOmnipolymathStateLeaseWorker<T>(
  lease: OmnipolymathStateWorkerLeaseContext,
  context: OmnipolymathStateWorkerContext,
  operation: (scope: DomainScope, identity: OmnipolymathStateLeaseIdentity) => Promise<T>,
  authority?: OmnipolymathStateLeaseWorkerAuthority,
): Promise<T> {
  return withOmnipolymathStateLeaseWorkerAdmission(
    lease,
    context.admission.databasePath,
    async (admission) => {
      const { runOmnipolymathStateWorkerOperation } = await import("./omnipolymath-state-worker-store.js");
      return runOmnipolymathStateWorkerOperation(
        context,
        (scope) => operation(scope, admission.identity),
        {
          assertCurrent: admission.assertCurrent,
          createAdmission: admission.createAdmission,
          signal: authority?.signal,
        },
      );
    },
    authority,
  );
}

/** Share one actor operation while every original lease retains its native settlement. */
export function runWithOmnipolymathStateLeasesWorker<T>(
  leases: readonly OmnipolymathStateWorkerLeaseContext[],
  context: OmnipolymathStateWorkerContext,
  operation: (scope: DomainScope, identities: readonly OmnipolymathStateLeaseIdentity[]) => Promise<T>,
  authority?: OmnipolymathStateLeaseWorkerAuthority,
): Promise<T> {
  return withOmnipolymathStateLeasesWorkerAdmission(
    leases,
    context,
    async (admission) => {
      const { runOmnipolymathStateWorkerOperation } = await import("./omnipolymath-state-worker-store.js");
      admission.assertCurrent();
      return runOmnipolymathStateWorkerOperation(
        context,
        (scope) => operation(scope, admission.identities),
        {
          assertCurrent: admission.assertCurrent,
          createAdmission: admission.createAdmission,
          signal: authority?.signal,
        },
      );
    },
    authority,
  );
}
