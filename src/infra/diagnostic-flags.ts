import { normalizeLowercaseStringOrEmpty } from "@omnipolymath/normalization-core/string-coerce";
import { normalizeUniqueStringEntriesLower } from "@omnipolymath/normalization-core/string-normalization";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { parseDiagnosticEnvFlags } from "./diagnostic-flags-env.js";

const DIAGNOSTICS_ENV = "OMNIPOLYMATH_DIAGNOSTICS";

/** Returns whether a diagnostic flag is enabled after config/env resolution. */
export function isDiagnosticFlagEnabled(
  flag: string,
  cfg?: OmnipolymathConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const configFlags = cfg?.diagnostics?.flags ?? [];
  const envFlags = parseDiagnosticEnvFlags(env[DIAGNOSTICS_ENV]);
  const enabledFlags = envFlags.disablesAll
    ? []
    : normalizeUniqueStringEntriesLower([...configFlags, ...envFlags.flags]);
  const target = normalizeLowercaseStringOrEmpty(flag);
  if (!target) {
    return false;
  }
  for (const enabled of enabledFlags) {
    if (enabled === "*" || enabled === "all" || enabled === target) {
      return true;
    }
    if (enabled.endsWith(".*") && target === enabled.slice(0, -2)) {
      return true;
    }
    if (enabled.endsWith("*") && target.startsWith(enabled.slice(0, -1))) {
      return true;
    }
  }
  return false;
}
