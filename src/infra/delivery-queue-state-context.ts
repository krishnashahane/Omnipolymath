import { resolveStateDir } from "../config/state-dir.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import type { OmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.types.js";
import { isGatewayExternallySupervised } from "./gateway-supervision.js";

export type DeliveryQueueStateContext = {
  stateDir: string;
  workerContext: OmnipolymathStateWorkerContext;
  supervisorMode?: "external";
};

export function captureDeliveryQueueStateContext(stateDir?: string): DeliveryQueueStateContext {
  const env = resolveDeliveryQueueStateEnv(stateDir);
  return {
    workerContext: captureOmnipolymathStateWorkerContext({ env }),
    stateDir: resolveStateDir(env),
    ...(isGatewayExternallySupervised(process.env) ? { supervisorMode: "external" as const } : {}),
  };
}

export function resolveDeliveryQueueStateEnv(
  stateDir?: string,
  context?: DeliveryQueueStateContext,
): NodeJS.ProcessEnv {
  return context
    ? {
        ...process.env,
        OMNIPOLYMATH_STATE_DIR: context.stateDir,
        // Captured absence must not inherit a later ambient supervisor mode.
        OMNIPOLYMATH_SUPERVISOR_MODE: context.supervisorMode,
      }
    : stateDir
      ? { ...process.env, OMNIPOLYMATH_STATE_DIR: stateDir }
      : process.env;
}
