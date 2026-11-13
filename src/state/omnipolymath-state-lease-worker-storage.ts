import { throwSqliteLifecycleErrors } from "../infra/sqlite-lifecycle-errors.js";
import {
  createSqliteWorkerWriteAdmission,
  type SqliteWorkerStore,
} from "../infra/sqlite-worker-store.js";
import { openOmnipolymathStateDatabase } from "./omnipolymath-state-db.js";
import type { OmnipolymathStateLeaseLifecycleOperations } from "./omnipolymath-state-lease-context.js";
import { OmnipolymathStateLeaseError } from "./omnipolymath-state-lease-error.js";
import { leaseHeartbeatState } from "./omnipolymath-state-lease-heartbeat-shared.js";
import { startOmnipolymathStateLeaseTimer } from "./omnipolymath-state-lease-heartbeat.js";
import {
  resolveLeaseDatabasePath,
  type OmnipolymathStateLeaseDatabase,
  type OmnipolymathStateLeaseNativeSource,
} from "./omnipolymath-state-lease-storage.js";
import type {
  createOmnipolymathStateLeaseWorkerOwner,
  WorkerLeaseScope,
} from "./omnipolymath-state-lease-worker-owner.js";
import type {
  OmnipolymathStateLeaseAcquisition,
  OmnipolymathStateLeaseIdentity,
} from "./omnipolymath-state-lease.types.js";
import { captureOmnipolymathStateWorkerContext } from "./omnipolymath-state-worker-context.js";
import type { OmnipolymathStateWorkerContext } from "./omnipolymath-state-worker-context.types.js";

export async function acquireLease(
  database: OmnipolymathStateLeaseDatabase,
  input: {
    identity: OmnipolymathStateLeaseIdentity;
    leaseMs: number;
    operationLabel: string;
    processBound?: boolean;
  },
  assertCurrent: () => void,
  signal?: AbortSignal,
  captureSource?: (source: OmnipolymathStateLeaseNativeSource) => void,
) {
  if (database.options?.readOnly) {
    throw new Error("State lease acquisition requires writable storage");
  }
  if (database.schemaPolicy === "existing" && database.options?.database) {
    throw new Error("Existing-state writes require their own tracked writable connection.");
  }
  const opened =
    database.schemaPolicy === "existing" ? undefined : openOmnipolymathStateDatabase(database.options);
  const context = captureOmnipolymathStateWorkerContext({
    ...database.options,
    path: opened?.path ?? resolveLeaseDatabasePath(database),
  });
  const sourceIdentity = Object.freeze({ ...context.admission.identity });
  const assertAdmission = () => {
    context.admission.assertCurrent();
    assertCurrent();
    // The worker cannot join a transaction held by the caller's verification handle.
    if (opened?.db.isTransaction) {
      throw new OmnipolymathStateLeaseError("State lease acquisition requires no active transaction", {
        code: "OMNIPOLYMATH_STATE_LEASE_INVALID_INPUT",
      });
    }
  };
  const { runOmnipolymathStateWorkerOperation } = await import("./omnipolymath-state-worker-store.js");
  assertAdmission();
  const result = await runOmnipolymathStateWorkerOperation(
    context,
    (scope) =>
      scope.execute(
        {
          type: "stateLease.acquire",
          input: { ...input, schemaPolicy: database.schemaPolicy },
        },
        { signal },
      ),
    {
      existingOnly: database.schemaPolicy === "existing",
      assertCurrent: assertAdmission,
      createAdmission: createSqliteWorkerWriteAdmission(assertAdmission, [
        context.admission.databasePath,
      ]),
    },
  );
  if (!result) {
    throw new Error("State lease acquisition requires an existing database");
  }
  if (result.kind === "acquired") {
    assertAdmission();
    captureSource?.({ context, identity: sourceIdentity, database: opened });
  }
  return result;
}

type LeaseWorkerOwner = ReturnType<typeof createOmnipolymathStateLeaseWorkerOwner>;
type LeaseWorkerOperation<T> = (
  scope: Pick<SqliteWorkerStore<OmnipolymathStateLeaseLifecycleOperations>, "execute">,
  identity: OmnipolymathStateLeaseIdentity,
) => Promise<T>;

/** Keep this importer's admission and release code available across package replacement. */
export async function prepareOmnipolymathStateLeaseStorageRuntime(): Promise<void> {
  await Promise.all([
    import("./omnipolymath-state-worker-store.js"),
    import("../infra/sqlite-worker-identity.js"),
    import("../infra/sqlite-worker-store.js"),
  ]);
}

function admittedWorkerOperation<T>(
  context: OmnipolymathStateWorkerContext,
  operation: LeaseWorkerOperation<T>,
) {
  return async (admission: WorkerLeaseScope): Promise<T> => {
    const { runOmnipolymathStateWorkerOperation } = await import("./omnipolymath-state-worker-store.js");
    return runOmnipolymathStateWorkerOperation(
      context,
      (scope) => operation(scope, admission.identity),
      { assertCurrent: admission.assertCurrent, createAdmission: admission.createAdmission },
    );
  };
}

/** Preserve the original admission, maintenance scope and coordinator runtime. */
export function createOmnipolymathStateLeaseWorkerStorage(
  context: OmnipolymathStateWorkerContext,
  processBound = false,
) {
  const storage = {
    path: context.admission.databasePath,
    assertCurrent() {
      context.maintenanceScope?.assertAdmission();
      context.admission.assertCurrent();
    },
    async withRetainedStartup<T>(
      operation: (startupContext: OmnipolymathStateWorkerContext) => Promise<T>,
      assertCurrent: () => void,
    ): Promise<T> {
      assertCurrent();
      const { runOmnipolymathStateWorkerOperation } = await import("./omnipolymath-state-worker-store.js");
      return runOmnipolymathStateWorkerOperation(context, () => operation(context), { assertCurrent });
    },
    acquire(
      owner: LeaseWorkerOwner,
      leaseMs: number,
      operationLabel: string,
      signal?: AbortSignal,
      observeExpiry = false,
    ): Promise<OmnipolymathStateLeaseAcquisition> {
      return owner.runLifecycle(
        "acquire",
        admittedWorkerOperation(context, (scope, identity) =>
          scope.execute(
            {
              type: "stateLease.acquire",
              input: {
                identity,
                leaseMs,
                operationLabel,
                processBound,
                ...(observeExpiry ? { observeExpiry: true as const } : {}),
              },
            },
            { signal },
          ),
        ),
      );
    },
    verify(owner: LeaseWorkerOwner, signal?: AbortSignal): Promise<number> {
      return owner.runLifecycle(
        "verify",
        admittedWorkerOperation(context, (scope, identity) =>
          scope.execute({ type: "stateLease.verify", input: { identity } }, { signal }),
        ),
      );
    },
    renew(
      owner: LeaseWorkerOwner,
      leaseMs: number,
      operationLabel: string,
      signal?: AbortSignal,
    ): Promise<number> {
      return owner.runLifecycle(
        "renew",
        admittedWorkerOperation(context, (scope, identity) =>
          scope.execute(
            {
              type: "stateLease.renew",
              input: { identity, leaseMs, operationLabel },
            },
            { signal },
          ),
        ),
      );
    },
    startTimer(
      owner: LeaseWorkerOwner,
      params: {
        identity: { scope: string; key: string };
        observation: BigInt64Array<SharedArrayBuffer>;
        leaseMs: number;
        heartbeatMs: number;
        operationLabel: string;
        signal: AbortSignal;
        onLost(error: unknown): void;
      },
    ): ReturnType<typeof startOmnipolymathStateLeaseTimer> & {
      verify(): Promise<number>;
      renew(): Promise<number>;
    } {
      const renew = () =>
        storage.renew(owner, params.leaseMs, params.operationLabel, params.signal);
      const timer = startOmnipolymathStateLeaseTimer({
        identity: params.identity,
        observation: params.observation,
        leaseMs: params.leaseMs,
        heartbeatMs: params.heartbeatMs,
        renew,
        onRenewError(error) {
          try {
            owner.rethrowIfUncertain(error, undefined);
          } catch (uncertainty) {
            params.onLost(uncertainty);
            return;
          }
          if (
            (error instanceof OmnipolymathStateLeaseError &&
              error.code === "OMNIPOLYMATH_STATE_LEASE_LOST") ||
            Number(Atomics.load(params.observation, leaseHeartbeatState.expiresAt)) <= Date.now()
          ) {
            params.onLost(error);
          }
        },
        onLost: (error) => params.onLost(error),
      });
      return {
        ...timer,
        verify: () => storage.verify(owner, params.signal),
        renew,
      };
    },
    release(owner: LeaseWorkerOwner, operationLabel: string): Promise<void> {
      return owner.runLifecycle("release", async (admission) => {
        const { runSqliteWorkerStoreOperation } = await import("../infra/sqlite-worker-store.js");
        const { openOmnipolymathStateWorkerCleanupStore } =
          await import("./omnipolymath-state-worker-store.js");
        const expectedIdentity = context.admission.identity;
        admission.assertCurrent();
        const cleanupContext = {
          environment: context.environment,
          existingSchemaPath: context.existingSchemaPath,
          stateIntegrity: context.stateIntegrity,
        };
        // Canonical close seals reads first; this owner retains only release authority.
        const store = await openOmnipolymathStateWorkerCleanupStore(
          storage.path,
          cleanupContext,
          admission.assertCurrent,
          expectedIdentity,
          context.maintenanceScope,
        );
        if (!store) {
          throw new Error("State lease cleanup lost its original database");
        }
        const errors: unknown[] = [];
        try {
          await runSqliteWorkerStoreOperation(
            store,
            (scope) =>
              scope.execute({
                type: "stateLease.release",
                input: {
                  identity: admission.identity,
                  operationLabel,
                  databaseIdentity: expectedIdentity.key,
                },
              }),
            cleanupContext,
            admission.assertCurrent,
            admission.createAdmission,
          );
        } catch (error) {
          errors.push(error);
        }
        try {
          await store.close();
        } catch (error) {
          errors.push(error);
        }
        throwSqliteLifecycleErrors(errors, "State lease release and worker close failed");
      });
    },
  };
  return storage;
}
