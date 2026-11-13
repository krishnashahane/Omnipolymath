import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import { isDiagnosticFlagEnabled } from "omnipolymath/plugin-sdk/diagnostic-flags";

const PROFILER_FLAGS = ["profiler", "codex.profiler"] as const;

export function isCodexAppServerProfilerEnabled(
  config?: OmnipolymathConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return PROFILER_FLAGS.some((flag) => isDiagnosticFlagEnabled(flag, config, env));
}
