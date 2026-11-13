import { normalizeOptionalString } from "@omnipolymath/normalization-core/string-coerce";

export function resolveDaemonContainerContext(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return (
    normalizeOptionalString(env.OMNIPOLYMATH_CONTAINER_HINT) ||
    normalizeOptionalString(env.OMNIPOLYMATH_CONTAINER) ||
    null
  );
}
