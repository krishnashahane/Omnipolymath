import { resolveGlobalMap } from "../../shared/global-singleton.js";
import {
  registerOmnipolymathStateDatabaseAsyncResource,
  registerOmnipolymathStatePathCacheInvalidation,
} from "../../state/omnipolymath-state-db-cache.js";
import type { OmnipolymathStateWorkerContext } from "../../state/omnipolymath-state-worker-context.types.js";
import type {
  ChannelIngressFailedHealth,
  ChannelIngressPressureSnapshot,
} from "./ingress-queue-read-contract.js";

type HealthCache = {
  path: string;
  failed?: ChannelIngressFailedHealth[];
  pressure?: ChannelIngressPressureSnapshot & { readAtMs: number };
};

const caches = resolveGlobalMap<string, HealthCache>(
  Symbol.for("omnipolymath.channelIngressHealth"),
  "close-and-restart",
);

registerOmnipolymathStateDatabaseAsyncResource({
  async close() {
    caches.clear();
  },
});

registerOmnipolymathStatePathCacheInvalidation(caches);

export function channelIngressHealthCache(context: OmnipolymathStateWorkerContext): HealthCache {
  const { coordinationKey, identity } = context.admission;
  let cache = caches.get(coordinationKey);
  if (!cache) {
    cache = { path: identity.canonicalPath };
    caches.set(coordinationKey, cache);
  }
  return cache;
}

/** A settling queue mutation retires even a snapshot whose read is still in flight. */
export function invalidateChannelIngressHealth(context: OmnipolymathStateWorkerContext): void {
  caches.delete(context.admission.coordinationKey);
}
