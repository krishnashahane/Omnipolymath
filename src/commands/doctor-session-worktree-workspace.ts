import { migrateManagedWorktreeCanonicalWorkspaces } from "../config/sessions/worktree-workspace-migration.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import {
  listExistingAgentDatabaseTargets,
  type ExistingAgentDatabaseTarget,
} from "../infra/session-sqlite-migration-readers.js";
import {
  closeOmnipolymathAgentDatabaseByPathAsync,
  isOmnipolymathAgentDatabaseOpen,
} from "../state/omnipolymath-agent-db.js";
import { runDoctorAgentDatabaseOperationAsync } from "./doctor-agent-database-operation.js";

/** Run after key repairs, whose source claims include workspace metadata. */
export async function repairLegacySessionWorktreeWorkspaces(params: {
  apply: boolean;
  cfg: OmnipolymathConfig;
  env: NodeJS.ProcessEnv;
  targets?: readonly ExistingAgentDatabaseTarget[];
}) {
  const targets = params.targets ?? listExistingAgentDatabaseTargets(params.cfg, params.env);
  let found = 0;
  let repaired = 0;
  for (const target of targets) {
    const wasOpen = isOmnipolymathAgentDatabaseOpen(target.sqlitePath);
    try {
      const operation = await runDoctorAgentDatabaseOperationAsync({
        agentId: target.agentId,
        path: target.sqlitePath,
        run: () =>
          migrateManagedWorktreeCanonicalWorkspaces({
            agentId: target.agentId,
            cfg: params.cfg,
            env: params.env,
            storePath: target.sqlitePath,
            mode: params.apply ? "doctor-fix" : "detect",
          }),
      });
      if (operation.ok) {
        found += operation.value.found;
        repaired += operation.value.repaired;
      }
    } finally {
      if (!wasOpen) {
        await closeOmnipolymathAgentDatabaseByPathAsync(target.sqlitePath);
      }
    }
  }
  return { found, repaired, scannedStores: targets.length };
}
