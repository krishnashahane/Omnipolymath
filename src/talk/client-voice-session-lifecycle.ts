import { AsyncLocalStorage } from "node:async_hooks";
import {
  releaseSessionSourceAuthorities,
  type PreparedSessionSourceAuthority,
} from "../config/sessions/session-source-authority.js";
import { GATEWAY_SHUTDOWN_TIMEOUT_MS } from "../infra/gateway-shutdown-budget.js";
import { runBestEffortCleanup } from "../infra/non-fatal-cleanup.js";
import {
  captureSqliteWorkerStateContext,
  runWithSqliteWorkerStateContext,
} from "../infra/sqlite-worker-state-context.js";
import { getProcessCleanupBudget } from "../process/supervisor/cleanup-budget.js";
import { GatewayRetainedWorkScope, type AsyncWorkScope } from "../shared/async-work-scope.js";
import { createDeferredCore } from "../shared/deferred.js";
import { registerOmnipolymathStatePathAsyncResource } from "../state/omnipolymath-state-db-cache.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import type { OmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.types.js";

const current = new AsyncLocalStorage<{
  context: OmnipolymathStateWorkerContext;
  scope: AsyncWorkScope;
  active: boolean;
}>();
const lifetimes = new Map<string, ReturnType<typeof createLifetime>>();

function createLifetime({ admission }: OmnipolymathStateWorkerContext) {
  const work = new GatewayRetainedWorkScope(undefined, {
    abortPendingAfterMs: () => {
      const budget = getProcessCleanupBudget();
      const remainingMs = budget
        ? Math.max(0, budget.deadline - performance.now())
        : GATEWAY_SHUTDOWN_TIMEOUT_MS;
      // Embedded close and store retirement use this grace plus abort settlement;
      // process exit applies its shorter outer prelude deadline.
      return Math.min(30_000, Math.floor(remainingMs / 4));
    },
    reason: "[talk] voice session persistence shutdown grace expired; abort requested",
  });
  const owner = {
    matchesDatabase(context: OmnipolymathStateWorkerContext) {
      const identity = context.admission.identity;
      return (
        admission.identity.key === identity.key &&
        admission.identity.birthtime === identity.birthtime
      );
    },
    retainGateway: () => work.retainGateway(),
    assertOpen(inherited: boolean) {
      if (work.isClosing && !inherited) {
        throw new Error("Voice session persistence admission is closed");
      }
    },
    scope: () => work.scope,
  };
  const unregister = registerOmnipolymathStatePathAsyncResource(admission, async () => {
    await work.beginDrainAll();
    if (work.hasGateways) {
      // A store reopen retires admitted work, not the Gateways that still own cleanup.
      work.reopen();
    } else {
      for (const [key, candidate] of lifetimes) {
        if (candidate === owner) {
          lifetimes.delete(key);
        }
      }
      unregister();
    }
  });
  return owner;
}

function lifetime(context: OmnipolymathStateWorkerContext) {
  let owner = lifetimes.get(context.admission.coordinationKey);
  if (!owner) {
    // First creation preserves a path coordination key; reopening the same file gets a file key.
    owner = [...lifetimes.values()].find((candidate) => candidate.matchesDatabase(context));
    owner ??= createLifetime(context);
    lifetimes.set(context.admission.coordinationKey, owner);
  }
  return owner;
}

/** Retain the original owner for later admissions without retaining an accepted permit. */
export function captureClientVoiceSessionSettlementContext(
  env: NodeJS.ProcessEnv,
): OmnipolymathStateWorkerContext {
  const inherited = current.getStore()?.context;
  const selected =
    inherited && inherited.environment.OMNIPOLYMATH_STATE_DIR === env.OMNIPOLYMATH_STATE_DIR
      ? inherited
      : captureOmnipolymathStateWorkerContext({ env });
  return { ...captureSqliteWorkerStateContext(selected), admission: selected.admission };
}

/** Retain accepted work before a bounded queue or provider can yield. */
export function captureClientVoiceSessionSettlement(source?: OmnipolymathStateWorkerContext) {
  const inherited = current.getStore();
  const selected = source ?? inherited?.context ?? captureOmnipolymathStateWorkerContext();
  const inheritedSource =
    inherited && matchesSettlementContext(inherited.context, selected) ? inherited : undefined;
  if (inheritedSource && !inheritedSource.active) {
    throw new Error("Voice session persistence lost its accepted owner");
  }
  selected.admission.assertCurrent();
  const context = inheritedSource?.context ?? {
    ...captureSqliteWorkerStateContext(selected),
    admission: selected.admission,
  };
  const owner = lifetime(context);
  owner.assertOpen(Boolean(inheritedSource));
  const scope = inheritedSource?.scope ?? owner.scope();
  const settled = createDeferredCore();
  void scope.track(() => settled.promise);
  const operation = { context, scope, active: true };
  return {
    run<T>(run: () => T): T {
      if (!operation.active) {
        throw new Error("Voice session persistence lost its accepted owner");
      }
      context.admission.assertCurrent();
      return scope.run(() =>
        current.run(operation, () => runWithSqliteWorkerStateContext(context, run)),
      );
    },
    // Refused entry does not settle accepted work; its lifetime owner releases it.
    release() {
      operation.active = false;
      settled.resolve();
    },
  };
}

export async function withClientVoiceSessionSettlement<T>(
  run: () => Promise<T>,
  onAdmissionFailure?: (error: unknown) => Promise<T>,
  source?: OmnipolymathStateWorkerContext,
): Promise<T> {
  let accepted: ReturnType<typeof captureClientVoiceSessionSettlement> | undefined;
  let entered = false;
  try {
    accepted = captureClientVoiceSessionSettlement(source);
    return await accepted.run(() => {
      entered = true;
      return run();
    });
  } catch (error) {
    // Close still owns provider teardown after refusal, but may not replay entered work.
    if (!entered && onAdmissionFailure) {
      return await onAdmissionFailure(error);
    }
    throw error;
  } finally {
    accepted?.release();
  }
}

function matchesSettlementContext(
  left: OmnipolymathStateWorkerContext,
  right: OmnipolymathStateWorkerContext,
) {
  return (
    left.admission.coordinationKey === right.admission.coordinationKey &&
    left.admission.identity.key === right.admission.identity.key &&
    left.admission.identity.birthtime === right.admission.identity.birthtime
  );
}

export function assertClientVoiceSessionSettlementCurrent(
  source?: OmnipolymathStateWorkerContext,
): void {
  const accepted = current.getStore();
  if (accepted && (!source || matchesSettlementContext(accepted.context, source))) {
    if (!accepted.active) {
      throw new Error("Voice session persistence lost its accepted owner");
    }
    accepted.context.admission.assertCurrent();
  }
}

export function prepareClientVoiceSessionClose() {
  return lifetime(captureOmnipolymathStateWorkerContext()).retainGateway();
}

/** Await all cleanup without making an acknowledged operation appear replayable. */
export async function withClientVoiceSessionResources<T>(
  resources:
    | readonly Pick<PreparedSessionSourceAuthority, "release">[]
    | (() => readonly Pick<PreparedSessionSourceAuthority, "release">[]),
  operation: () => Promise<T>,
): Promise<T> {
  const errors: unknown[] = [];
  const release = () =>
    releaseSessionSourceAuthorities(
      typeof resources === "function" ? resources() : resources,
      errors,
    );
  try {
    return await operation();
  } catch (error) {
    errors.push(error);
    throw error;
  } finally {
    if (errors.length > 0) {
      await release();
    } else {
      await runBestEffortCleanup({
        cleanup: release,
        onError: (error) =>
          console.warn("[talk] voice session operation completed before cleanup failed", error),
      });
    }
  }
}
