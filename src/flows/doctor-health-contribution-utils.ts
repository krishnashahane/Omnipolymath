import { note } from "../../packages/terminal-core/src/note.js";
import { resolveAgentWorkspaceDir, tryResolveSoleAgentId } from "../agents/agent-scope.js";
import { isLegacyParentWritableUpdateDoctorPass } from "../commands/doctor/shared/update-phase.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import type { DoctorHealthFlowContext } from "./doctor-health-contribution-types.js";

export function isUpdateDoctorRun(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean {
  const value = env.OMNIPOLYMATH_UPDATE_IN_PROGRESS;
  return value === "1" || value === "true";
}

export function resolveDoctorMode(cfg: OmnipolymathConfig): "local" | "remote" {
  return cfg.gateway?.mode === "remote" ? "remote" : "local";
}
export function resolveDoctorWorkspaceDir(cfg: OmnipolymathConfig, env = process.env) {
  const agentId = tryResolveSoleAgentId(cfg);
  return agentId ? resolveAgentWorkspaceDir(cfg, agentId, env) : undefined;
}

export function resolveLegacyParentVersionOverride(ctx: DoctorHealthFlowContext): {
  lastTouchedVersionOverride?: string;
} {
  if (!isLegacyParentWritableUpdateDoctorPass(ctx.env ?? process.env)) {
    return {};
  }
  const version = ctx.configResult.sourceLastTouchedVersion?.trim();
  return version ? { lastTouchedVersionOverride: version } : {};
}

export function noteDoctorRepairResult(result: {
  changes: readonly string[];
  notices?: readonly string[];
  warnings: readonly string[];
}): void {
  for (const kind of ["changes", "notices", "warnings"] as const) {
    if (result[kind]?.length) {
      note(result[kind].join("\n"), `Doctor ${kind}`);
    }
  }
}
