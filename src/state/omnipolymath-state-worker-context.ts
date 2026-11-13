import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import { resolveStateDir } from "../config/state-dir.js";
import { isStateDatabaseReadAdmissionInvalidatedError } from "./omnipolymath-state-db-async-lifecycle.js";
import {
  captureOmnipolymathStateDatabaseReadAdmission,
  omnipolymathStateDatabaseCache,
} from "./omnipolymath-state-db-cache.js";
import { resolveOmnipolymathStateSqlitePath } from "./omnipolymath-state-db.paths.js";
import {
  captureOmnipolymathStateReadContextWithAdmission,
  captureOmnipolymathStateReadWorkerContextWithAdmission,
  captureOmnipolymathStateWorkerContextWithAdmission,
} from "./omnipolymath-state-worker-context.capture.js";
import type { OmnipolymathStateWorkerContext } from "./omnipolymath-state-worker-context.types.js";

export type OmnipolymathStateReadContext = ReturnType<
  typeof captureOmnipolymathStateReadContextWithAdmission
>;

/** Capture read authority without constructing a worker environment. */
export function captureOmnipolymathStateReadContext(
  pathname = resolveOmnipolymathStateSqlitePath(),
): OmnipolymathStateReadContext {
  return captureOmnipolymathStateReadContextWithAdmission(
    pathname,
    captureOmnipolymathStateDatabaseReadAdmission,
    omnipolymathStateDatabaseCache.getKnownOmnipolymathStateDatabaseIdentity,
  );
}

/** Read-only workers need resolved runtime facts, not the initialization environment. */
export function captureOmnipolymathStateReadWorkerContext(
  options: { path?: string; env?: NodeJS.ProcessEnv } = {},
): OmnipolymathStateWorkerContext {
  return captureOmnipolymathStateReadWorkerContextWithAdmission(
    options,
    captureOmnipolymathStateDatabaseReadAdmission,
    omnipolymathStateDatabaseCache.getKnownOmnipolymathStateDatabaseIdentity,
  );
}

/** Resident readers retain their source and schema policy without re-admitting each publication. */
export function prepareOmnipolymathStateReadSource(input: { path: string; env?: NodeJS.ProcessEnv }) {
  const env = cloneEnvWithPlatformSemantics(input.env ?? process.env);
  env.OMNIPOLYMATH_STATE_DIR = resolveStateDir(env);
  const options = { path: path.resolve(input.path), env };
  const inSourceContext = AsyncLocalStorage.snapshot();
  const original = captureOmnipolymathStateReadContext(options.path);
  let context = original;
  let worker: OmnipolymathStateWorkerContext | undefined;

  const refresh = () => {
    original.maintenanceScope?.assertAdmission();
    if (!original.admission.identity.key.startsWith("file:")) {
      original.admission.assertCurrent();
    }
    const next = captureOmnipolymathStateReadContext(options.path);
    const source = original.admission.identity;
    if (
      next.admission.identity.key !== source.key ||
      next.admission.identity.birthtime !== source.birthtime ||
      next.maintenanceScope !== original.maintenanceScope ||
      next.existingSchemaPath !== original.existingSchemaPath ||
      next.gatewayServiceInstallation !== original.gatewayServiceInstallation
    ) {
      throw new Error("Prepared state read source changed before read admission");
    }
    return (context = next);
  };
  const current = () => {
    context.maintenanceScope?.assertAdmission();
    try {
      context.admission.assertCurrent();
      if (context.admission.identity.key.startsWith("file:")) {
        return context;
      }
    } catch (error) {
      if (!isStateDatabaseReadAdmissionInvalidatedError(error)) {
        throw error;
      }
    }
    return inSourceContext(refresh);
  };
  const prepareWorker = () => {
    const next = refresh();
    worker ??= captureOmnipolymathStateWorkerContext(options);
    if (worker.admission !== next.admission) {
      worker = { ...worker, ...next };
    }
    return worker;
  };
  return {
    current,
    workerContext: () => inSourceContext(prepareWorker),
    withCurrent<T>(consume: (context: OmnipolymathStateWorkerContext) => T): T {
      return inSourceContext(() => consume(prepareWorker()));
    },
  };
}

export function captureOmnipolymathStateWorkerContext(
  options: Parameters<typeof captureOmnipolymathStateWorkerContextWithAdmission>[0] = {},
): OmnipolymathStateWorkerContext {
  return captureOmnipolymathStateWorkerContextWithAdmission(
    options,
    captureOmnipolymathStateDatabaseReadAdmission,
    omnipolymathStateDatabaseCache.getKnownOmnipolymathStateDatabaseIdentity,
  );
}
