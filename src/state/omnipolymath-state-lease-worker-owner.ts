import { isDeepStrictEqual } from "node:util";
import {
  collectNestedErrorCandidates,
  extractErrorCode,
} from "@omnipolymath/normalization-core/error-coercion";
import { isPromiseLike } from "@omnipolymath/normalization-core/promise-like";
import { isRecord } from "@omnipolymath/normalization-core/record-coerce";
import type { Result } from "@omnipolymath/normalization-core/result";
import { createSqliteLifecycleAggregateError } from "../infra/sqlite-lifecycle-errors.js";
import { SqliteWorkerError } from "../infra/sqlite-worker-contract.js";
import type { DatabasePathIdentity } from "../infra/sqlite-worker-identity.js";
import {
  createSqliteWorkerOperationAdmission,
  type SqliteWorkerAdmissionFactory,
} from "../infra/sqlite-worker-operation-admission.js";
import type { SqliteWorkerOperationSettlement } from "../infra/sqlite-worker-operation-settlement.js";
import { createDeferredCore } from "../shared/deferred.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import type { OmnipolymathStateWorkerLeaseContext } from "./omnipolymath-state-lease-context.js";
import { OmnipolymathStateLeaseError } from "./omnipolymath-state-lease-error.js";
import type { OmnipolymathStateLeaseIdentity } from "./omnipolymath-state-lease.types.js";
import type { OmnipolymathStateWorkerContext } from "./omnipolymath-state-worker-context.types.js";

export type OmnipolymathStateLeaseWorkerPurpose = "write" | "acquire" | "verify" | "renew" | "release";

export type OmnipolymathStateLeaseWorkerAuthority = {
  signal?: AbortSignal;
  assertCurrent(this: void): void;
  /** Live authority for the first write grant, separate from transport preparation. */
  beforeTransaction?(this: void): void;
  beforeCommit?(this: void): void;
};

export type WorkerLeaseScope = {
  identity: OmnipolymathStateLeaseIdentity;
  assertCurrent(this: void): void;
  createAdmission: SqliteWorkerAdmissionFactory;
};
type WorkerLeasesScope = Omit<WorkerLeaseScope, "identity"> & {
  identities: readonly OmnipolymathStateLeaseIdentity[];
};
type RetainedLeaseScope = {
  identity: OmnipolymathStateLeaseIdentity;
  databasePath: string;
  sourceIdentity?: DatabasePathIdentity;
  assertCurrent(this: void): void;
  retainSettlement(settled: Promise<SqliteWorkerOperationSettlement>): void;
  settleNative(
    settled: Promise<SqliteWorkerOperationSettlement>,
    outcome: SqliteWorkerOperationSettlement,
  ): void;
  rethrowIfUncertain(failure: unknown, authorityError: unknown): void;
  finish(): void;
};
type WorkerLeaseOwner = {
  identity: OmnipolymathStateLeaseIdentity;
  sourceIdentity?: DatabasePathIdentity;
  sourceContext?: OmnipolymathStateWorkerContext;
  assertSourceCurrent(): void;
  retain(
    databasePath: string,
    purpose: OmnipolymathStateLeaseWorkerPurpose,
    authority?: OmnipolymathStateLeaseWorkerAuthority,
  ): RetainedLeaseScope;
  run<T>(
    databasePath: string,
    operation: (scope: WorkerLeaseScope) => Promise<T>,
    purpose: OmnipolymathStateLeaseWorkerPurpose,
    authority?: OmnipolymathStateLeaseWorkerAuthority,
  ): Promise<T>;
};
const owners = resolveGlobalSingleton(
  Symbol.for("omnipolymath.stateLeaseWorkerOwners"),
  () => new WeakMap<OmnipolymathStateWorkerLeaseContext, WorkerLeaseOwner>(),
);

function ownershipRefused(): never {
  throw new OmnipolymathStateLeaseError("State lease worker ownership was refused", {
    code: "OMNIPOLYMATH_STATE_LEASE_LOST",
  });
}

function assertSynchronousAuthority(assertion: (() => void) | undefined): void {
  const result: unknown = assertion?.();
  if (isPromiseLike(result)) {
    void Promise.resolve(result).catch(() => {});
    throw new Error("State lease worker authority must complete synchronously");
  }
}

function captureLeaseWorkerSource(context: OmnipolymathStateWorkerContext) {
  const { admission, maintenanceScope } = context;
  const assertAdmission = admission.assertCurrent;
  const assertMaintenance = maintenanceScope?.assertAdmission;
  return () => {
    // Internal callers keep this context immutable; retain the actual authority, not its fields.
    assertMaintenance?.();
    assertAdmission();
  };
}

function createLeaseAdmissionFactory(
  scopes: readonly RetainedLeaseScope[],
  purpose: OmnipolymathStateLeaseWorkerPurpose,
  assertCurrent: () => void,
  beforeCommit?: () => void,
  options: {
    plural?: boolean;
    expiryObservation?: SharedArrayBuffer;
    beforeTransaction?: () => void;
  } = {},
): SqliteWorkerAdmissionFactory {
  const firstScope = scopes[0];
  if (!firstScope) {
    throw new Error("State lease admission requires a retained owner");
  }
  return (retained) => {
    assertCurrent();
    // All original owners retain the same native outcome before a port can escape.
    for (const scope of scopes) {
      scope.retainSettlement(retained.settled);
    }
    void retained.settled.then((outcome) => {
      // Poison every participating owner in one turn before any release can observe settlement.
      for (const scope of scopes) {
        scope.settleNative(retained.settled, outcome);
      }
    });
    let prepareTransaction = options.beforeTransaction;
    const expiryRequired = purpose === "write" || purpose === "verify" || purpose === "renew";
    return {
      nativeLocations: [...new Set(scopes.map((scope) => scope.databasePath))],
      ...(firstScope.sourceIdentity?.key.startsWith("file:")
        ? {
            databaseIdentity: {
              databasePath: firstScope.databasePath,
              key: firstScope.sourceIdentity.key,
              birthtime: firstScope.sourceIdentity.birthtime,
            },
          }
        : {}),
      admission: createSqliteWorkerOperationAdmission(
        (request, grant) => {
          assertCurrent();
          const facts = request.facts;
          const kind = options.plural
            ? "state-leases"
            : purpose === "write"
              ? "state-lease"
              : `state-lease-${purpose}`;
          if (!isRecord(facts) || facts.kind !== kind) {
            ownershipRefused();
          }
          const members: unknown = options.plural ? facts.leases : [facts];
          if (!Array.isArray(members) || members.length !== scopes.length) {
            ownershipRefused();
          }
          const assertFacts = () => {
            const now = Date.now();
            for (const [index, scope] of scopes.entries()) {
              const member: unknown = members[index];
              if (
                !isRecord(member) ||
                !isDeepStrictEqual(member.identity, scope.identity) ||
                (expiryRequired &&
                  (typeof member.expiresAt !== "number" ||
                    !Number.isFinite(member.expiresAt) ||
                    member.expiresAt <= now))
              ) {
                ownershipRefused();
              }
            }
          };
          assertFacts();
          if (purpose === "write" && prepareTransaction) {
            assertSynchronousAuthority(prepareTransaction);
            prepareTransaction = undefined;
            assertCurrent();
            assertFacts();
          }
          if (purpose === "write" && request.stage === "commit") {
            assertSynchronousAuthority(beforeCommit);
            assertCurrent();
            // Synchronous host work can consume the worker's remaining lease lifetime.
            assertFacts();
          }
          // The native transaction owns ordering; every grant still checks live authority.
          grant();
        },
        options.expiryObservation &&
          (purpose === "acquire" || purpose === "verify" || purpose === "renew")
          ? {
              kind: "state-lease-expiry",
              identity: firstScope.identity,
              observation: options.expiryObservation,
            }
          : undefined,
      ),
    };
  };
}

function runRetainedLeaseScopes<T>(
  scopes: readonly RetainedLeaseScope[],
  operation: () => Promise<T>,
): Promise<T> {
  const result = (async () => {
    try {
      const value = await operation();
      for (const scope of scopes) {
        scope.rethrowIfUncertain(undefined, undefined);
      }
      return value;
    } catch (failure) {
      for (const scope of scopes) {
        scope.rethrowIfUncertain(failure, undefined);
      }
      throw failure;
    } finally {
      for (const scope of scopes) {
        scope.finish();
      }
    }
  })();
  // Custody also owns abandoned failures; callers still receive the original rejecting result.
  void result.catch(() => {});
  return result;
}

/** Registered only by the actual lease owner, never reconstructed from a receipt. */
export function createOmnipolymathStateLeaseWorkerOwner(params: {
  lease?: OmnipolymathStateWorkerLeaseContext;
  identity: OmnipolymathStateLeaseIdentity;
  databasePath: string;
  sourceContext?: OmnipolymathStateWorkerContext;
  sourceIdentity?: DatabasePathIdentity;
  expiryObservation?: SharedArrayBuffer;
  assertCurrent(purpose: OmnipolymathStateLeaseWorkerPurpose): void;
}) {
  const assertSourceCurrent = params.sourceContext
    ? captureLeaseWorkerSource(params.sourceContext)
    : undefined;
  const sourceIdentity = params.sourceIdentity && Object.freeze({ ...params.sourceIdentity });
  const pending = new Set<Promise<unknown>>();
  const settlements = new Set<Promise<unknown>>();
  let accepting = true;
  let closed = false;
  let uncertain: { error: SqliteWorkerError } | undefined;
  const unknownOutcome = (cause: unknown) =>
    Object.assign(
      new SqliteWorkerError("State lease worker transaction outcome is unknown", "outcome-unknown"),
      { cause },
    );
  const assertCurrent = (purpose: OmnipolymathStateLeaseWorkerPurpose) => {
    if (uncertain) {
      throw uncertain.error;
    }
    if (closed) {
      throw new OmnipolymathStateLeaseError("State lease worker admission is closed", {
        code: "OMNIPOLYMATH_STATE_LEASE_LOST",
      });
    }
    params.assertCurrent(purpose);
  };
  const rethrowIfUncertain = (failure: unknown, authorityError: unknown): void => {
    const uncertainty =
      uncertain?.error ??
      collectNestedErrorCandidates(failure).find(
        (candidate) => extractErrorCode(candidate) === "outcome-unknown",
      );
    if (uncertainty === undefined) {
      return;
    }
    const errors = [
      ...new Set(
        [uncertainty, failure, ...(authorityError === undefined ? [] : [authorityError])].filter(
          (error) => error !== undefined,
        ),
      ),
    ];
    if (errors.length === 1) {
      throw uncertainty instanceof Error ? uncertainty : unknownOutcome(uncertainty);
    }
    throw unknownOutcome(
      createSqliteLifecycleAggregateError(
        errors,
        "state lease operation has an unknown write outcome",
        uncertainty,
      ),
    );
  };
  const owner: WorkerLeaseOwner = {
    identity: params.identity,
    get sourceIdentity() {
      // First creation publishes its physical file through the original retained admission.
      return sourceIdentity ?? params.sourceContext?.admission.identity;
    },
    sourceContext: params.sourceContext,
    assertSourceCurrent() {
      if (!assertSourceCurrent) {
        throw new Error("State leases require their original shared source context");
      }
      assertSourceCurrent();
    },
    retain(databasePath, purpose, authority) {
      const assertCaller = authority?.assertCurrent;
      assertCurrent(purpose);
      if (
        (!accepting && purpose !== "release" && purpose !== "verify") ||
        databasePath !== params.databasePath
      ) {
        throw new Error("State lease worker operation differs from its live owner");
      }
      const completion = createDeferredCore();
      pending.add(completion.promise);
      let active = true;
      return {
        identity: params.identity,
        databasePath: params.databasePath,
        sourceIdentity: owner.sourceIdentity,
        assertCurrent() {
          assertCurrent(purpose);
          assertCaller?.();
          if (!active) {
            throw new Error("State lease worker operation has settled");
          }
        },
        retainSettlement(settled) {
          settlements.add(settled);
        },
        settleNative(settled, settlement) {
          if (settlement.kind === "unknown") {
            uncertain ??= { error: unknownOutcome(settlement.error) };
            accepting = false;
          }
          settlements.delete(settled);
        },
        rethrowIfUncertain,
        finish() {
          active = false;
          pending.delete(completion.promise);
          completion.resolve();
        },
      };
    },
    run(databasePath, operation, purpose, authority) {
      const beforeTransaction = authority?.beforeTransaction;
      const beforeCommit = authority?.beforeCommit;
      const scope = owner.retain(databasePath, purpose, authority);
      return runRetainedLeaseScopes([scope], () =>
        operation({
          identity: { ...scope.identity },
          assertCurrent: scope.assertCurrent,
          createAdmission: createLeaseAdmissionFactory(
            [scope],
            purpose,
            scope.assertCurrent,
            beforeCommit,
            {
              expiryObservation: params.expiryObservation,
              beforeTransaction,
            },
          ),
        }),
      );
    },
  };
  let boundLease = params.lease;
  if (boundLease) {
    owners.set(boundLease, owner);
  }
  const settle = async () => {
    accepting = false;
    await Promise.allSettled(pending);
    await Promise.allSettled(settlements);
  };
  return {
    // Draining stops new effects; retained scopes still own their native settlement.
    assertCurrent(this: void) {
      assertCurrent("write");
      if (!accepting) {
        throw new Error("State lease worker operation differs from its live owner");
      }
    },
    bind(lease: OmnipolymathStateWorkerLeaseContext) {
      if (closed || boundLease) {
        throw new Error("State lease worker owner is already bound or closed");
      }
      boundLease = lease;
      owners.set(lease, owner);
    },
    runLifecycle<T>(
      purpose: "acquire" | "verify" | "renew" | "release",
      operation: (scope: WorkerLeaseScope) => Promise<T>,
    ): Promise<T> {
      return owner.run(params.databasePath, operation, purpose);
    },
    run<T>(operation: () => Promise<T>): Promise<T> {
      return owner.run(params.databasePath, operation, "write");
    },
    canRelease: () => pending.size === 0 && settlements.size === 0 && !uncertain,
    settle,
    rethrowIfUncertain,
    async drain() {
      await settle();
      if (uncertain) {
        throw uncertain.error;
      }
    },
    close() {
      accepting = false;
      closed = true;
      if (boundLease) {
        owners.delete(boundLease);
      }
    },
  };
}

export function withOmnipolymathStateLeaseWorkerAdmission<T>(
  lease: OmnipolymathStateWorkerLeaseContext,
  databasePath: string,
  operation: (scope: WorkerLeaseScope) => Promise<T>,
  authority?: OmnipolymathStateLeaseWorkerAuthority,
): Promise<T> {
  const owner = owners.get(lease);
  if (!owner) {
    throw new OmnipolymathStateLeaseError(
      "State lease worker operation requires its original live lease context",
      { code: "OMNIPOLYMATH_STATE_LEASE_LOST" },
    );
  }
  return owner.run(databasePath, operation, "write", authority);
}

/** A serving-owner reply acknowledges native settlement; a lost reply poisons the original lease. */
export function withOmnipolymathStateLeaseRemoteAdmission<T>(
  lease: OmnipolymathStateWorkerLeaseContext,
  databasePath: string,
  operation: (scope: {
    identity: OmnipolymathStateLeaseIdentity;
    sourceIdentity: DatabasePathIdentity;
    signal: AbortSignal;
    assertCurrent: () => void;
  }) => Promise<Result<T, Error>>,
): Promise<T> {
  const owner = owners.get(lease);
  if (!owner) {
    throw new Error("Remote journal mutation requires its original live lease context");
  }
  const sourceIdentity = owner.sourceIdentity;
  if (!sourceIdentity?.key.startsWith("file:") || sourceIdentity.birthtime === undefined) {
    throw new Error("Remote journal mutation requires its captured physical database identity");
  }
  const scope = owner.retain(databasePath, "write");
  const settlement = createDeferredCore<SqliteWorkerOperationSettlement>();
  scope.retainSettlement(settlement.promise);
  const settle = (outcome: SqliteWorkerOperationSettlement) => {
    scope.settleNative(settlement.promise, outcome);
    settlement.resolve(outcome);
  };
  return runRetainedLeaseScopes([scope], async () => {
    let result: Result<T, Error>;
    try {
      scope.assertCurrent();
      owner.assertSourceCurrent();
      result = await operation({
        identity: { ...scope.identity },
        sourceIdentity: { ...sourceIdentity },
        signal: lease.signal,
        assertCurrent: () => {
          scope.assertCurrent();
          owner.assertSourceCurrent();
        },
      });
    } catch (error) {
      // Do not release or compensate while the other host may still hold a native writer.
      settle({ kind: "unknown", error });
      throw error;
    }
    settle({ kind: "completed" });
    scope.assertCurrent();
    owner.assertSourceCurrent();
    if (!result.ok) {
      throw result.error;
    }
    return result.value;
  });
}

/** Multiple leases authorize one worker operation only from their shared captured source. */
export function withOmnipolymathStateLeasesWorkerAdmission<T>(
  leases: readonly OmnipolymathStateWorkerLeaseContext[],
  context: OmnipolymathStateWorkerContext,
  operation: (scope: WorkerLeasesScope) => Promise<T>,
  authority?: OmnipolymathStateLeaseWorkerAuthority,
): Promise<T> {
  if (leases.length === 0) {
    throw new Error("State lease worker operation requires at least one live lease");
  }
  const assertCaller = authority?.assertCurrent;
  const beforeTransaction = authority?.beforeTransaction;
  const beforeCommit = authority?.beforeCommit;
  const selected = leases.map((lease) => {
    const owner = owners.get(lease);
    if (!owner || owner.sourceContext !== context) {
      throw new Error("State leases require their original shared source context");
    }
    return owner;
  });
  const keys = new Set(
    selected.map(({ identity }) => JSON.stringify([identity.scope, identity.key])),
  );
  if (new Set(selected).size !== selected.length || keys.size !== selected.length) {
    throw new Error("State lease worker operation contains duplicate leases");
  }
  const scopes: RetainedLeaseScope[] = [];
  const assertCurrent = () => {
    assertSynchronousAuthority(assertCaller);
    for (const scope of scopes) {
      scope.assertCurrent();
    }
    for (const owner of selected) {
      owner.assertSourceCurrent();
    }
  };
  try {
    for (const owner of selected) {
      scopes.push(owner.retain(context.admission.databasePath, "write"));
    }
    assertCurrent();
  } catch (error) {
    for (const scope of scopes) {
      scope.finish();
    }
    throw error;
  }
  return runRetainedLeaseScopes(scopes, () =>
    operation({
      identities: scopes.map(({ identity }) => ({ ...identity })),
      assertCurrent,
      createAdmission: createLeaseAdmissionFactory(
        scopes,
        "write",
        assertCurrent,
        () => assertSynchronousAuthority(beforeCommit),
        { plural: true, beforeTransaction },
      ),
    }),
  );
}
