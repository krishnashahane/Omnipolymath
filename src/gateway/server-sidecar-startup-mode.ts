import { isTruthyEnvValue } from "../infra/env.js";

// Startup mode shared by the server implementation and post-ready sidecar scheduler.
export type GatewaySidecarStartupMode = "start" | "defer";

export function isChannelStartupSuppressedByEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isTruthyEnvValue(env.OMNIPOLYMATH_SKIP_CHANNELS) || isTruthyEnvValue(env.OMNIPOLYMATH_SKIP_PROVIDERS)
  );
}
