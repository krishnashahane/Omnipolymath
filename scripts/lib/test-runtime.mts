import { isCiEnvironment, resolvePinnedBun } from "./pinned-bun.mts";

let fallbackReported = false;

export function resolveTestRuntime(env: NodeJS.ProcessEnv = process.env): "node" | "bun" {
  const runtime = env.OMNIPOLYMATH_VITEST_RUNTIME?.trim();
  if (runtime) {
    if (runtime !== "node" && runtime !== "bun") {
      throw new Error(`Invalid OMNIPOLYMATH_VITEST_RUNTIME: ${runtime}; expected node or bun`);
    }
    return runtime;
  }
  if (isCiEnvironment(env)) {
    return "node";
  }
  const bun = resolvePinnedBun(env);
  if (bun.command) {
    return "bun";
  }
  if (!fallbackReported) {
    fallbackReported = true;
    console.error(
      `[omnipolymath] Bun fork unavailable (${bun.reason}); using Node. Set OMNIPOLYMATH_VITEST_RUNTIME=node to silence.`,
    );
  }
  return "node";
}
