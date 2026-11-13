/** Redacted health diagnostics for durable channel ingress queues. */
import { formatErrorMessage } from "../../infra/errors.js";
import { executeExistingOmnipolymathStateRead } from "../../state/omnipolymath-state-db-readonly.js";
import type { OmnipolymathStateWorkerContext } from "../../state/omnipolymath-state-worker-context.types.js";
import { resolveChannelIngressStateEnv } from "./ingress-queue-client.js";
import { channelIngressHealthCache } from "./ingress-queue-health-cache.js";
import type {
  ChannelIngressFailedHealth,
  ChannelIngressHealthErrors,
  ChannelIngressPressureHealth,
} from "./ingress-queue-read-contract.js";

export async function countFailedChannelIngressQueueEntries(
  stateDir?: string,
): Promise<ChannelIngressFailedHealth[]> {
  const reply = await executeExistingOmnipolymathStateRead(
    { env: resolveChannelIngressStateEnv(stateDir) },
    { type: "channelIngress.failedHealth" },
  );
  if (!reply) {
    return [];
  }
  return reply.result;
}

export type ChannelIngressQueueHealth = {
  failed: ChannelIngressFailedHealth[];
  pressure: ChannelIngressPressureHealth[];
  errors?: ChannelIngressHealthErrors;
};

export async function countChannelIngressQueueHealth(
  stateDir?: string,
  context?: OmnipolymathStateWorkerContext,
): Promise<ChannelIngressQueueHealth> {
  const cache = context ? channelIngressHealthCache(context) : undefined;
  const now = Date.now();
  const failed = cache?.failed;
  const pressure =
    cache?.pressure &&
    now >= cache.pressure.readAtMs &&
    now < (cache.pressure.nextClaimExpiryAtMs ?? Infinity)
      ? cache.pressure.pressure
      : undefined;
  if (failed && pressure) {
    return { failed, pressure };
  }
  try {
    const reply = await executeExistingOmnipolymathStateRead(
      { env: resolveChannelIngressStateEnv(stateDir) },
      {
        type: "channelIngress.health",
        input: { now, failed: !failed, pressure: !pressure },
      },
    );
    if (!reply) {
      return { failed: failed ?? [], pressure: pressure ?? [] };
    }
    if (cache) {
      if (reply.result.failed) {
        cache.failed = reply.result.failed;
      }
      if (reply.result.pressure) {
        cache.pressure = { ...reply.result.pressure, readAtMs: now };
      }
    }
    return {
      failed: reply.result.failed ?? failed ?? [],
      pressure: reply.result.pressure?.pressure ?? pressure ?? [],
      errors: reply.result.errors,
    };
  } catch (error) {
    const message = formatErrorMessage(error);
    return {
      failed: failed ?? [],
      pressure: pressure ?? [],
      errors: {
        ...(!failed ? { failed: message } : {}),
        ...(!pressure ? { pressure: message } : {}),
      },
    };
  }
}
