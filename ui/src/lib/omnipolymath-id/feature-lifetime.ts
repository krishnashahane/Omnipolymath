// The enabled feature's mounted lifetime. Omnipolymath ID dialogs open only while it runs
// and close when it ends, so turning the Labs switch off retires them.
let current: AbortController | undefined;

/** Starts the lifetime when the enabled feature mounts; the returned function ends it. */
export function startOmnipolymathIdFeatureLifetime(): () => void {
  const lifetime = new AbortController();
  current = lifetime;
  return () => {
    lifetime.abort();
    if (current === lifetime) {
      current = undefined;
    }
  };
}

/** The running lifetime's signal; an aborted one while the feature is off. */
export function omnipolymathIdFeatureSignal(): AbortSignal {
  return current?.signal ?? AbortSignal.abort();
}
