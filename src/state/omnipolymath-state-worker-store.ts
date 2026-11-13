import type { DatabasePathIdentity } from "../infra/sqlite-worker-identity.js";
import type { SqliteWorkerStateContext } from "../infra/sqlite-worker-state-context.js";
import { runPluginSharedStateWork } from "../plugins/plugin-shared-state-admission.js";
import {
  getOmnipolymathStateDatabaseTerminalFailureAsync,
  recordOmnipolymathStateDatabaseOpenFailure,
  omnipolymathStateDatabaseCache,
} from "./omnipolymath-state-db-cache.js";
import { findOmnipolymathStateDatabaseFailure } from "./omnipolymath-state-db-failure.js";
import type { OmnipolymathDatabaseMaintenanceScope } from "./omnipolymath-state-maintenance-context.js";
import type { OmnipolymathStateWorkerContext } from "./omnipolymath-state-worker-context.types.js";
import type {
  OmnipolymathStateWorkerOperations,
  OmnipolymathStateWorkerOperationOptions as OperationOptions,
} from "./omnipolymath-state-worker-contract.js";
import { hydrateOmnipolymathStateWorkerError } from "./omnipolymath-state-worker-error.js";
import {
  retainOmnipolymathStateWorkerLease,
  type OmnipolymathStateWorkerLease,
} from "./omnipolymath-state-worker-lease.js";
import {
  runWithCapturedWorkerContext,
  runWithOmnipolymathStateWorkerStore,
} from "./omnipolymath-state-worker-operation.js";
import { getOmnipolymathStateWorkerOwner as owner } from "./omnipolymath-state-worker-owner.js";
import type { DomainScope } from "./omnipolymath-state-worker-store.types.js";

export type { OmnipolymathStateWorkerLease } from "./omnipolymath-state-worker-lease.js";

/** Retired cleanup uses the retained owner's backend without renewing read admission. */
export function openOmnipolymathStateWorkerCleanupStore(
  databasePath: string,
  context: SqliteWorkerStateContext,
  assertOwned: () => void,
  identity: DatabasePathIdentity,
  maintenanceScope?: OmnipolymathDatabaseMaintenanceScope,
) {
  return owner().openCleanup(databasePath, context, assertOwned, identity, maintenanceScope);
}

export async function executeOmnipolymathStateWorker<Key extends keyof OmnipolymathStateWorkerOperations>(
  context: OmnipolymathStateWorkerContext,
  command: { type: Key; input: OmnipolymathStateWorkerOperations[Key]["input"] },
): Promise<OmnipolymathStateWorkerOperations[Key]["output"]> {
  const result = await runOmnipolymathStateWorkerOperation(context, (scope) => scope.execute(command));
  context.admission.assertCurrent();
  return result;
}

/** Retain the canonical actor for capture callbacks and their terminal writes. */
export function createOmnipolymathStateWorkerLease(
  context: OmnipolymathStateWorkerContext,
  finalize?: (scope: DomainScope) => Promise<void>,
  onNativeLost?: () => void,
): OmnipolymathStateWorkerLease {
  return retainOmnipolymathStateWorkerLease(
    context,
    {
      open: (captured) => owner().open(captured),
      retainOperation: (store, listener) => owner().retainOperation(store, listener),
    },
    finalize,
    onNativeLost,
  );
}

/** Retain the actor through its durable result and main-process reconciliation. */
export function runOmnipolymathStateWorkerOperation<T>(
  context: OmnipolymathStateWorkerContext,
  operation: (scope: DomainScope) => Promise<T>,
  options?: OperationOptions & { existingOnly?: false },
): Promise<T>;
export function runOmnipolymathStateWorkerOperation<T>(
  context: OmnipolymathStateWorkerContext,
  operation: (scope: DomainScope) => Promise<T>,
  options: OperationOptions & { existingOnly: boolean },
): Promise<T | undefined>;
export async function runOmnipolymathStateWorkerOperation<T>(
  context: OmnipolymathStateWorkerContext,
  operation: (scope: DomainScope) => Promise<T>,
  options?: OperationOptions,
): Promise<T | undefined> {
  return runPluginSharedStateWork(() =>
    runWithCapturedWorkerContext(context, async () => {
      try {
        options?.signal?.throwIfAborted();
        context.admission.assertCurrent();
        options?.assertCurrent?.();
        const failure = await getOmnipolymathStateDatabaseTerminalFailureAsync(
          context,
          options?.signal,
        );
        if (failure) {
          throw failure;
        }
        context.admission.assertCurrent();
        options?.assertCurrent?.();
        const store = await owner().open(context, options);
        if (!store) {
          options?.signal?.throwIfAborted();
          context.admission.assertCurrent();
          if (options?.existingOnly) {
            return undefined;
          }
          throw new Error("Canonical shared-state worker did not open its database");
        }
        const releaseOperation = owner().retainOperation(store);
        try {
          options?.signal?.throwIfAborted();
          context.admission.assertCurrent();
          options?.assertCurrent?.();
          return await runWithOmnipolymathStateWorkerStore(
            store,
            context,
            operation,
            options?.assertCurrent,
            options?.createAdmission,
            options?.signal,
          );
        } finally {
          // The owner observes retirement; other clients may await this operation's result.
          void releaseOperation();
        }
      } catch (error) {
        const hydrated = hydrateOmnipolymathStateWorkerError(error);
        const failure = findOmnipolymathStateDatabaseFailure(hydrated, context.admission.databasePath);
        if (
          failure &&
          !omnipolymathStateDatabaseCache.getOmnipolymathStateDatabaseRecordedFailure(
            context.admission.databasePath,
          )
        ) {
          try {
            context.admission.assertCurrent();
          } catch {
            // A retired generation cannot publish a refusal against its replacement.
            throw hydrated;
          }
          recordOmnipolymathStateDatabaseOpenFailure(context.admission.databasePath, failure);
        }
        throw hydrated;
      }
    }),
  );
}
