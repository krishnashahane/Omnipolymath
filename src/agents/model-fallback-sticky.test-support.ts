import { readGlobalSingleton } from "../shared/global-singleton.js";

export function resetStickyRateLimitFallbacksForTest(): void {
  const stickyFallbacks = readGlobalSingleton(Symbol.for("omnipolymath.stickyRateLimitFallbacks")) as
    | Map<unknown, unknown>
    | undefined;
  stickyFallbacks?.clear();
}
