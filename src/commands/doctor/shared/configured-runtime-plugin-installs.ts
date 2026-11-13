import { asOptionalRecord } from "@omnipolymath/normalization-core/record-coerce";
import {
  collectConfiguredAgentHarnessRuntimes,
  type ConfiguredAgentHarnessRuntimeOptions,
} from "../../../agents/harness-runtimes.js";
import type { OmnipolymathConfig } from "../../../config/types.omnipolymath.js";

export function acpxRuntimeIsConfigured(cfg: OmnipolymathConfig): boolean {
  const acp = asOptionalRecord(cfg.acp);
  const backend = typeof acp?.backend === "string" ? acp.backend.trim().toLowerCase() : "";
  return backend
    ? backend === "acpx"
    : acp?.enabled === true || asOptionalRecord(acp?.dispatch)?.enabled === true;
}

/** Collect runtime ids without loading plugin metadata during startup planning. */
export function collectConfiguredRuntimeIds(
  cfg: OmnipolymathConfig,
  options?: ConfiguredAgentHarnessRuntimeOptions,
): string[] {
  const ids = new Set(collectConfiguredAgentHarnessRuntimes(cfg, options));
  if (acpxRuntimeIsConfigured(cfg)) {
    ids.add("acpx");
  }
  return [...ids].toSorted((left, right) => left.localeCompare(right));
}
