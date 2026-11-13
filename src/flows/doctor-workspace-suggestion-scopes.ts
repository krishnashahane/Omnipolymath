import { listAgentIds, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";

type DoctorWorkspaceSuggestionScope = {
  agentId: string;
  workspaceDir: string;
  labelAgent: boolean;
};

/** An explicitly empty roster owns no workspaces to inspect. */
export function resolveDoctorWorkspaceSuggestionScopes(
  cfg: OmnipolymathConfig,
): DoctorWorkspaceSuggestionScope[] {
  const agentIds = listAgentIds(cfg);
  const labelAgent = agentIds.length > 1;
  return agentIds.map((agentId) => ({
    agentId,
    workspaceDir: resolveAgentWorkspaceDir(cfg, agentId),
    labelAgent,
  }));
}
