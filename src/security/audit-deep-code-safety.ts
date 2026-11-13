import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import type { SecurityAuditFinding } from "./audit.types.js";

export async function collectDeepCodeSafetyFindings(params: {
  cfg: OmnipolymathConfig;
  stateDir: string;
  deep: boolean;
  workspaceDir?: string;
}): Promise<SecurityAuditFinding[]> {
  if (!params.deep) {
    return [];
  }

  const auditDeep = await import("./audit.deep.runtime.js");
  return [
    ...(await auditDeep.collectPluginsCodeSafetyFindings({
      stateDir: params.stateDir,
    })),
    ...(await auditDeep.collectInstalledSkillsCodeSafetyFindings({
      cfg: params.cfg,
      stateDir: params.stateDir,
      workspaceDir: params.workspaceDir,
    })),
  ];
}
