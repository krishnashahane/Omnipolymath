// Host-owned SQLite leases serialize trusted work across processes.
import { randomUUID } from "node:crypto";
import { materializeErrorStack } from "../infra/error-graph-internal.js";
import { isPostgresSqlConnection, type EngineConnection } from "../infra/sql-connection.js";
import { isSqliteLockError } from "../infra/sqlite-error-diagnostics.js";
import { createSqliteLifecycleAggregateError } from "../infra/sqlite-lifecycle-errors.js";
import { stageSqliteTransactionState } from "../infra/sqlite-post-commit.js";
import { scheduleAbsoluteDeadline } from "../utils/absolute-deadline.js";
import {
  getOmnipolymathDatabaseMaintenanceScope,
  type OmnipolymathDatabaseMaintenanceScope,
} from "./omnipolymath-state-db-async-lifecycle.js";
import { isManagedStateTransaction } from "./omnipolymath-state-db-transaction.js";
import { acquireOmnipolymathStateLease } from "./omnipolymath-state-lease-acquisition.js";
import { createOmnipolymathStateLeaseCleanup } from "./omnipolymath-state-lease-cleanup.js";
import type {
  OmnipolymathStateLeaseContext,
  OmnipolymathStateAsyncLeaseContext,
} from "./omnipolymath-state-lease-context.js";
import {
  createOmnipolymathStateLeaseError as leaseError,
  createOmnipolymathStateLeaseAbortError as abortError,
  createOmnipolymathStateLeaseLostError,
  resolveOmnipolymathStateLeaseOperationError,
  OmnipolymathStateLeaseError,
} from "./omnipolymath-state-lease-error.js";
import {
  createLeaseHeartbeatState,
  readLeaseHeartbeatExpiry,
  leaseHeartbeatState,
} from "./omnipolymath-state-lease-heartbeat-shared.js";
import {
  startOmnipolymathStateLeaseHeartbeat,
  type startOmnipolymathStateLeaseTimer,
  type LeaseHeartbeatCleanup,
} from "./omnipolymath-state-lease-heartbeat.js";
import { startOmnipolymathStateLeaseNativeHeartbeat } from "./omnipolymath-state-lease-native-heartbeat.js";
import {
  validateOmnipolymathStateLeaseOptions,
  type OmnipolymathStateLeaseOptions,
  type OmnipolymathStateLeaseInvocation as LeaseInvocation,
} from "./omnipolymath-state-lease-options.js";
import { registerProcessExitLeaseCleanup } from "./omnipolymath-state-lease-process-exit.js";
import {
  createOmnipolymathStateLeaseLostErrorFromDatabase,
  prepareLeaseDatabase,
  prepareOmnipolymathStateLeaseVerification,
  resolveLeaseDatabasePath,
  renewOmnipolymathStateLease as renew,
  renewOmnipolymathStateLeaseForHandoff as renewForHandoff,
  verifyOmnipolymathStateLeaseOwnership as verifyLeaseOwnership,
  releaseOmnipolymathStateLease as release,
  releaseOmnipolymathStateLeaseBestEffort as releaseBestEffort,
  type OmnipolymathStateLeaseOwnerIdentity as LeaseIdentity,
  type OmnipolymathStateLeaseNativeSource,
} from "./omnipolymath-state-lease-storage.js";
import { renewOmnipolymathStateLeaseUnderWriteFence } from "./omnipolymath-state-lease-store.js";
import { createOmnipolymathStateLeaseWorkerOwner } from "./omnipolymath-state-lease-worker-owner.js";
import {
  acquireLease,
  createOmnipolymathStateLeaseWorkerStorage,
} from "./omnipolymath-state-lease-worker-storage.js";
import type { OmnipolymathStateLeaseIdentity } from "./omnipolymath-state-lease.types.js";
import type { OmnipolymathStateWorkerContext } from "./omnipolymath-state-worker-context.types.js";

export type {
  OmnipolymathStateLeaseContext,
  OmnipolymathStateAsyncLeaseContext,
} from "./omnipolymath-state-lease-context.js";
export { OmnipolymathStateLeaseError } from "./omnipolymath-state-lease-error.js";

/** Run one trusted operation under a host-owned SQLite lease. */
export async function withOmnipolymathStateLease<T>(
  options: OmnipolymathStateLeaseOptions,
  run: (lease: OmnipolymathStateLeaseContext, identity: OmnipolymathStateLeaseIdentity) => Promise<T>,
): Promise<T> {
  return runStateLeaseOwner({ kind: "native", options, run });
}

/**
 * Keep SQLite work in owned workers. The callback must not await closing its
 * own state database: canonical close waits for this complete lease operation.
 * Renewal uses the parent timer unless an independent worker is requested.
 */
export async function withOmnipolymathStateLeaseAsync<T>(
  options: Omit<OmnipolymathStateLeaseOptions, "database" | "prepareDatabase">,
  context: OmnipolymathStateWorkerContext,
  run: (lease: OmnipolymathStateAsyncLeaseContext, identity: OmnipolymathStateLeaseIdentity) => Promise<T>,
): Promise<T> {
  return runStateLeaseOwner({
    kind: "worker",
    options: {
      ...options,
      database: {
        scope: "shared",
        options: { path: context.admission.databasePath, env: context.environment },
      },
    },
    context,
    run,
  });
}

function runStateLeaseOwner<T>(invocation: LeaseInvocation<T>): Promise<T> {
  const maintenance =
    invocation.kind === "worker"
      ? invocation.context.maintenanceScope
      : getOmnipolymathDatabaseMaintenanceScope();
  const run = () => runStateLeaseOwnerInScope(invocation, maintenance);
  return maintenance ? maintenance.run(() => maintenance.track(run())) : run();
}

async function runStateLeaseOwnerInScope<T>(
  invocation: LeaseInvocation<T>,
  maintenance: OmnipolymathDatabaseMaintenanceScope | undefined,
): Promise<T> {
  const validated = validateOmnipolymathStateLeaseOptions(invocation.options);
  const renewalTimer: { dueAt?: number; lateByMs: number } = { lateByMs: 0 };
  const identity: LeaseIdentity = {
    scope: validated.scope,
    key: validated.key,
    owner: `${validated.operationLabel}:${randomUUID()}`,
    renewalTimer,
    leaseLabel: validated.leaseLabel,
  };
  let closed = false;
  let disposed = false;
  let phase: "acquiring" | "owned" | "draining" = "acquiring";
  let heartbeatStopped = true;
  const heartbeatCleanups = new Set<LeaseHeartbeatCleanup>();
  let workerHeartbeat: ReturnType<typeof startOmnipolymathStateLeaseHeartbeat> | undefined;
  let startingHeartbeat: ReturnType<typeof startOmnipolymathStateLeaseHeartbeat> | undefined;
  let timerHeartbeat: ReturnType<typeof startOmnipolymathStateLeaseTimer> | undefined;
  let asyncOwnership: { verify(): Promise<number>; renew(): Promise<number> } | undefined;
  let expiryObservation = invocation.kind === "worker" ? createLeaseHeartbeatState() : undefined;
  const workerStorage =
    invocation.kind === "worker"
      ? createOmnipolymathStateLeaseWorkerStorage(invocation.context, validated.processBound)
      : undefined;
  let workerOperations: ReturnType<typeof createOmnipolymathStateLeaseWorkerOwner> | undefined;
  let assertAcquisitionCurrent: (() => void) | undefined;
  let confirmedExpiresAt: number | undefined;
  let nativeLeaseSource: OmnipolymathStateLeaseNativeSource | undefined;
  let leaseVerification: Awaited<ReturnType<typeof prepareOmnipolymathStateLeaseVerification>>;
  const leaseLost = new AbortController();
  const operationSignal = validated.signal
    ? AbortSignal.any([validated.signal, leaseLost.signal])
    : leaseLost.signal;
  const heartbeatMs = Math.floor(validated.leaseMs / 3);
  let cancelExpiry: (() => void) | undefined;
  let nativeTimer: ReturnType<typeof startOmnipolymathStateLeaseNativeHeartbeat> | undefined;
  const abortLost = (cause?: unknown) => {
    if (!leaseLost.signal.aborted) {
      leaseLost.abort(
        cause instanceof OmnipolymathStateLeaseError
          ? cause
          : invocation.kind === "native" && phase === "owned" && !closed
            ? createOmnipolymathStateLeaseLostErrorFromDatabase(identity, validated.database, cause)
            : createOmnipolymathStateLeaseLostError(validated, cause),
      );
      materializeErrorStack(leaseLost.signal.reason);
    }
  };
  const assertActive = () => {
    leaseLost.signal.throwIfAborted();
    if (validated.signal?.aborted) {
      throw abortError(validated.signal, "operation", validated.leaseLabel);
    }
    if (
      closed ||
      timerHeartbeat?.isExpired() ||
      (phase === "owned" &&
        invocation.kind === "worker" &&
        expiryObservation !== undefined &&
        Number(Atomics.load(expiryObservation, leaseHeartbeatState.expiresAt)) <= Date.now())
    ) {
      abortLost();
      throw leaseLost.signal.reason;
    }
  };
  const assertOwnerCurrent = () => {
    assertActive();
    // Timer delivery can lag the persisted expiry; never admit an effect in that gap.
    if (closed || confirmedExpiresAt === undefined || Date.now() >= confirmedExpiresAt) {
      abortLost();
      throw leaseLost.signal.reason;
    }
  };
  const assertWorkerCurrent = validated.heartbeat === "worker" ? assertActive : assertOwnerCurrent;
  function stopWorker() {
    void workerHeartbeat?.stop().catch(abortLost);
    void startingHeartbeat?.stop().catch(abortLost);
  }
  const stopTimer = () => {
    nativeTimer?.stop();
    void timerHeartbeat?.stopRenewal();
  };
  let unregisterProcessExitCleanup: (() => void) | undefined;
  if (workerStorage) {
    workerOperations = createOmnipolymathStateLeaseWorkerOwner({
      identity: { scope: identity.scope, key: identity.key, owner: identity.owner },
      databasePath: workerStorage.path,
      sourceContext: invocation.kind === "worker" ? invocation.context : undefined,
      expiryObservation: expiryObservation?.buffer,
      assertCurrent(purpose) {
        if (disposed) {
          throw leaseError("OMNIPOLYMATH_STATE_LEASE_LOST", "State lease owner is closed");
        }
        if (purpose === "release") {
          if (phase !== "draining" || !heartbeatStopped) {
            throw new Error("State lease cleanup has not joined its heartbeat");
          }
          return;
        }
        workerStorage.assertCurrent();
        if (purpose === "acquire") {
          if (leaseLost.signal.aborted) {
            throw leaseLost.signal.reason;
          }
          if (phase !== "acquiring") {
            throw new Error("State lease acquisition has already settled");
          }
          assertAcquisitionCurrent?.();
          return;
        }
        assertActive();
        if (phase !== "owned") {
          throw new Error("State lease no longer admits operations");
        }
        workerHeartbeat?.assertRunning();
      },
    });
  }
  const releaseOwned = async () => {
    phase = "draining";
    const params = {
      ...identity,
      database: validated.database,
      operationLabel: validated.operationLabel,
    };
    const execution = workerOperations;
    // Runtime cleanup joins the worker writer queue; native contention must not abandon its lease.
    // Existing-schema maintenance keeps its subset writer's no-migration contract.
    const cleanupStorage =
      workerStorage ??
      (nativeLeaseSource && validated.database.schemaPolicy !== "existing"
        ? createOmnipolymathStateLeaseWorkerStorage(nativeLeaseSource.context)
        : undefined);
    await releaseBestEffort(
      params,
      cleanupStorage && execution
        ? () => cleanupStorage.release(execution, validated.operationLabel)
        : undefined,
    );
    await execution?.settle();
  };
  workerStorage?.assertCurrent();
  const cleanup = createOmnipolymathStateLeaseCleanup({
    maintenanceScope: maintenance,
    context: invocation.kind === "worker" ? invocation.context : undefined,
    nativeIdentity: () => nativeLeaseSource?.identity,
    workerOwner: () => workerOperations,
    // finish joins renewal settlement before a contended release schedules a retry.
    retryDeadline: () => readLeaseHeartbeatExpiry(expiryObservation, confirmedExpiresAt),
    revoke() {
      closed = true;
      abortLost(new Error("State lease resource owner is closing"));
      stopWorker();
    },
    async finish() {
      phase = "draining";
      closed = true;
      nativeTimer?.stop();
      await timerHeartbeat?.close();
      await workerOperations?.settle();
      const failures: unknown[] = [];
      for (const heartbeatCleanup of heartbeatCleanups) {
        try {
          await heartbeatCleanup.close();
          heartbeatCleanups.delete(heartbeatCleanup);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) {
        throw createSqliteLifecycleAggregateError(
          failures,
          "State lease heartbeat cleanup failed",
          failures[0],
        );
      }
      workerHeartbeat = undefined;
      heartbeatStopped = true;
      if (
        confirmedExpiresAt !== undefined &&
        (!workerOperations || workerOperations.canRelease())
      ) {
        await releaseOwned();
      }
      await workerOperations?.settle();
      disposed = true;
      workerOperations?.close();
      leaseVerification?.release();
      leaseVerification = undefined;
    },
  });
  const run = async (): Promise<T> => {
    try {
      await acquireOmnipolymathStateLease({
        label: `${validated.leaseLabel} ${validated.scope}/${validated.key}`,
        waitMs: validated.waitMs,
        signal: validated.signal,
        assertCurrent: () => leaseLost.signal.throwIfAborted(),
        prepare:
          invocation.kind === "native" &&
          validated.prepareDatabase &&
          validated.waitMs > 0 &&
          validated.database.schemaPolicy !== "existing"
            ? () => prepareLeaseDatabase(validated.database)
            : undefined,
        acquire(assertCurrent, signal) {
          assertAcquisitionCurrent = assertCurrent;
          return workerStorage && workerOperations
            ? workerStorage.acquire(
                workerOperations,
                validated.leaseMs,
                validated.operationLabel,
                signal,
                expiryObservation !== undefined,
              )
            : acquireLease(
                validated.database,
                {
                  identity,
                  operationLabel: validated.operationLabel,
                  leaseMs: validated.leaseMs,
                  processBound: validated.processBound,
                },
                assertCurrent,
                signal,
                (source) => {
                  nativeLeaseSource = source;
                },
              );
        },
        acquired(expiresAt) {
          confirmedExpiresAt = expiresAt;
          if (validated.signal?.aborted) {
            throw abortError(validated.signal, "operation", validated.leaseLabel);
          }
        },
      });
    } catch (error) {
      workerOperations?.rethrowIfUncertain(error, undefined);
      throw error;
    }
    if (confirmedExpiresAt === undefined) {
      throw new Error("State lease acquisition did not record its owner");
    }
    const acquiredAt = confirmedExpiresAt - validated.leaseMs;
    phase = "owned";
    if (nativeLeaseSource?.database) {
      leaseVerification = await prepareOmnipolymathStateLeaseVerification(nativeLeaseSource, identity);
    }
    // Startup refusal still owns release of the acquired row. Bind callback authority only after startup.
    workerOperations ??= createOmnipolymathStateLeaseWorkerOwner({
      identity: { scope: identity.scope, key: identity.key, owner: identity.owner },
      databasePath: resolveLeaseDatabasePath(validated.database),
      sourceContext: nativeLeaseSource?.context,
      sourceIdentity: nativeLeaseSource?.identity,
      assertCurrent: (purpose) => {
        if (purpose === "release") {
          if (disposed || phase !== "draining" || !heartbeatStopped) {
            throw new Error("State lease cleanup has not joined its heartbeat");
          }
          return;
        }
        assertWorkerCurrent();
        if (validated.database.schemaPolicy === "existing") {
          throw new Error("This lease mode does not support worker writes");
        }
        if (validated.heartbeat === "worker") {
          if (!workerHeartbeat) {
            abortLost();
            throw leaseLost.signal.reason;
          }
          // The worker transaction rechecks durable expiry; host grants only check liveness.
          workerHeartbeat.assertRunning();
        }
      },
    });
    // Legacy native callers release synchronously on process.exit(). Async callers
    // must unwind their scope before exiting so native worker teardown can join.
    unregisterProcessExitCleanup = registerProcessExitLeaseCleanup(() => {
      closed = true;
      workerOperations?.close();
      workerHeartbeat?.close();
      startingHeartbeat?.close();
      if (workerStorage || (workerOperations && !workerOperations.canRelease())) {
        return;
      }
      release({
        ...identity,
        database: validated.database,
        operationLabel: validated.operationLabel,
      });
    });
    const scheduleExpiry = () => {
      cancelExpiry?.();
      cancelExpiry = scheduleAbsoluteDeadline(
        confirmedExpiresAt ?? Date.now(),
        () => abortLost(),
        undefined,
        { unref: true },
      );
    };
    const renewAndSchedule = () => {
      confirmedExpiresAt = renew({
        ...identity,
        database: validated.database,
        operationLabel: validated.operationLabel,
        leaseMs: validated.leaseMs,
      });
      nativeTimer?.renewed();
      scheduleExpiry();
    };
    const renewOperation = () => {
      assertActive();
      if (workerHeartbeat) {
        assertOperationOwned();
      } else {
        renewAndSchedule();
      }
    };
    const assertOperationOwned = (transaction?: EngineConnection) => {
      assertActive();
      if (workerHeartbeat) {
        try {
          workerHeartbeat.assertRunning();
        } catch (error) {
          abortLost(error);
          throw leaseLost.signal.reason;
        }
      }
      if (!transaction && leaseVerification) {
        leaseVerification.verify();
        return;
      }
      // Transactions and offline cross-process leases always read their durable owner.
      verifyLeaseOwnership({ ...identity, database: validated.database, transaction });
    };
    const startWorker = async (expiresAt: number) => {
      const start = async (startupContext?: OmnipolymathStateWorkerContext) => {
        let started: ReturnType<typeof startOmnipolymathStateLeaseHeartbeat> | undefined;
        let startupCleanup: LeaseHeartbeatCleanup | undefined;
        try {
          started = startOmnipolymathStateLeaseHeartbeat({
            path: workerStorage?.path ?? resolveLeaseDatabasePath(validated.database),
            startupContext,
            identity,
            leaseMs: validated.leaseMs,
            acquiredAt,
            heartbeatMs,
            expiresAt,
            onLost: abortLost,
            expiryObservation,
            renewDuringStartup: () => {
              assertActive();
              if (!workerStorage || !workerOperations) {
                return renewForHandoff({
                  ...identity,
                  database: validated.database,
                  operationLabel: validated.operationLabel,
                  leaseMs: validated.leaseMs,
                });
              }
              const execution = workerOperations;
              return workerStorage
                .renew(execution, validated.leaseMs, validated.operationLabel, operationSignal)
                .catch((error: unknown) => {
                  execution.rethrowIfUncertain(error, undefined);
                  if (!isSqliteLockError(error)) {
                    throw error;
                  }
                  return workerStorage.verify(execution, operationSignal);
                });
            },
            retainCleanup(heartbeatCleanup) {
              startupCleanup = heartbeatCleanup;
              heartbeatCleanups.add(heartbeatCleanup);
              heartbeatStopped = false;
            },
          });
          expiryObservation ??= started.expiryObservation;
          startingHeartbeat = started;
          if (validated.signal?.aborted || leaseLost.signal.aborted) {
            stopWorker();
          }
          await started.ready;
          assertActive();
          startupContext?.admission.assertCurrent();
          workerHeartbeat = started;
        } catch (error) {
          try {
            await startupCleanup?.close();
            heartbeatStopped = [...heartbeatCleanups].every((entry) => !entry.pending);
          } catch (stopError) {
            throw createSqliteLifecycleAggregateError(
              [error, stopError],
              "state lease heartbeat startup and stop failed",
              error,
            );
          }
          throw error;
        } finally {
          if (heartbeatStopped || workerHeartbeat === started) {
            startingHeartbeat = undefined;
          }
        }
      };
      if (workerStorage) {
        await workerStorage.withRetainedStartup(start, assertActive);
      } else {
        await start();
      }
    };
    const drain = async () => {
      await timerHeartbeat?.stopRenewal();
      await workerOperations?.drain();
    };

    const usesOwnerCurrent =
      validated.processBound &&
      validated.heartbeat !== "worker" &&
      validated.database.schemaPolicy !== "existing";
    const assertNativeCurrent = usesOwnerCurrent ? assertWorkerCurrent : assertOperationOwned;
    let result: T;
    try {
      const execution = workerOperations;
      if (validated.heartbeat === "worker") {
        validated.signal?.addEventListener("abort", stopWorker, { once: true });
        await startWorker(confirmedExpiresAt);
        asyncOwnership = workerStorage ? workerHeartbeat : undefined;
      } else if (workerStorage) {
        if (!execution || !expiryObservation) {
          throw new Error("Async state lease timer owner is unavailable");
        }
        const timer = workerStorage.startTimer(execution, {
          identity,
          observation: expiryObservation,
          heartbeatMs,
          leaseMs: validated.leaseMs,
          operationLabel: validated.operationLabel,
          signal: operationSignal,
          onLost: abortLost,
        });
        timerHeartbeat = timer;
        asyncOwnership = timer;
        heartbeatStopped = false;
        operationSignal.addEventListener("abort", stopTimer, { once: true });
        if (operationSignal.aborted) {
          stopTimer();
        }
      } else {
        operationSignal.addEventListener("abort", stopTimer, { once: true });
        scheduleExpiry();
        nativeTimer = startOmnipolymathStateLeaseNativeHeartbeat({
          heartbeatMs,
          renewalTimer,
          signal: operationSignal,
          expiresAt: () => confirmedExpiresAt ?? Date.now(),
          renew: renewOperation,
          lose: abortLost,
        });
      }
      // Acquisition and callback entry are separate scheduling points. A
      // suspended process must not enter after its persisted lease expires.
      if (invocation.kind === "worker") {
        const verification = asyncOwnership;
        if (!execution || !verification) {
          throw new Error("Async state lease heartbeat did not start");
        }
        const verify = async (renewLease = false) => {
          assertActive();
          const expiresAt = await (renewLease ? verification.renew() : verification.verify());
          assertActive();
          workerHeartbeat?.assertRunning();
          confirmedExpiresAt = expiresAt;
        };
        await verify();
        const lease: OmnipolymathStateAsyncLeaseContext = {
          signal: operationSignal,
          assertCurrent: execution.assertCurrent,
          assertOwned: async () => execution.run(() => verify()),
          renew: async () => execution.run(() => verify(true)),
        };
        execution.bind(lease);
        result = await invocation.run(lease, identity);
      } else {
        assertNativeCurrent();
        const lease: OmnipolymathStateLeaseContext = {
          signal: operationSignal,
          assertCurrent: usesOwnerCurrent
            ? assertOwnerCurrent
            : () => operationSignal.throwIfAborted(),
          renew: renewOperation,
          assertOwned: assertOperationOwned,
          ...(workerHeartbeat
            ? {
                assertOwnedAsync: async () => {
                  assertActive();
                  const nativeHeartbeat = workerHeartbeat;
                  if (!nativeHeartbeat) {
                    abortLost();
                    throw leaseLost.signal.reason;
                  }
                  const expiresAt = await nativeHeartbeat.verify();
                  assertActive();
                  nativeHeartbeat.assertRunning();
                  if (expiresAt <= Date.now()) {
                    abortLost();
                    assertActive();
                  }
                },
              }
            : {}),
          assertOwnedInTransaction: assertOperationOwned,
          holdWriteFence(database) {
            if (!workerHeartbeat || isPostgresSqlConnection(database)) {
              return undefined;
            }
            if (!isManagedStateTransaction(database)) {
              throw new Error("Lease write fence requires a managed state transaction");
            }
            const startedAt = Date.now();
            const fence = workerHeartbeat.holdOwnerFence();
            let expiresAt: number | undefined;
            // Settlement callbacks retain the marker through the physical state
            // COMMIT/ROLLBACK, including when this fence joins an outer transaction.
            stageSqliteTransactionState(database, {
              stage() {},
              commit: () => fence.release(expiresAt),
              rollback: () => fence.release(),
            });
            assertOperationOwned(database);
            return {
              renew() {
                expiresAt = renewOmnipolymathStateLeaseUnderWriteFence(
                  database,
                  identity,
                  acquiredAt,
                  validated.leaseMs,
                );
                if (expiresAt === undefined) {
                  throw createOmnipolymathStateLeaseLostError(validated);
                }
                fence.renewed(expiresAt);
                const durationMs = Date.now() - startedAt;
                return durationMs >= validated.leaseMs
                  ? `${validated.leaseLabel}: state write fence held for ${durationMs} ms; renewed after the native commit.`
                  : undefined;
              },
            };
          },
        };
        execution.bind(lease);
        result = await invocation.run(lease, identity);
      }
      await drain();
    } catch (error) {
      let failure = error;
      try {
        await drain();
      } catch (drainError) {
        if (drainError !== error) {
          failure = createSqliteLifecycleAggregateError(
            [error, drainError],
            "state lease operation and drainage failed",
            error,
          );
        }
      }
      const authorityError: unknown = leaseLost.signal.aborted
        ? leaseLost.signal.reason
        : validated.signal?.aborted
          ? abortError(validated.signal, "operation", validated.leaseLabel)
          : undefined;
      workerOperations?.rethrowIfUncertain(failure, authorityError);
      throw resolveOmnipolymathStateLeaseOperationError(error, failure, authorityError);
    }
    if (workerStorage) {
      assertActive();
      await asyncOwnership?.verify();
      assertActive();
    } else {
      assertNativeCurrent();
    }
    return result;
  };
  return cleanup.run(run, () => {
    phase = "draining";
    closed = true;
    unregisterProcessExitCleanup?.();
    validated.signal?.removeEventListener("abort", stopWorker);
    operationSignal.removeEventListener("abort", stopTimer);
    nativeTimer?.close();
    nativeTimer = undefined;
    cancelExpiry?.();
    cancelExpiry = undefined;
  });
}
