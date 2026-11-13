type FallbackSkipCacheState = {
  buckets: Map<string, Map<string, unknown>>;
  lastGlobalPruneAtMs: number;
};

function getFallbackSkipCacheGlobals() {
  return globalThis as typeof globalThis & {
    omnipolymathFallbackSkipCacheState?: FallbackSkipCacheState;
  };
}

export function resetFallbackSkipCacheForTest(): void {
  const globals = getFallbackSkipCacheGlobals();
  globals.omnipolymathFallbackSkipCacheState?.buckets.clear();
  if (globals.omnipolymathFallbackSkipCacheState) {
    globals.omnipolymathFallbackSkipCacheState.lastGlobalPruneAtMs = 0;
  }
}

export function listFallbackSkipCacheSessionIdsForTest(): string[] {
  const globals = getFallbackSkipCacheGlobals();
  return [...(globals.omnipolymathFallbackSkipCacheState?.buckets.keys() ?? [])];
}
