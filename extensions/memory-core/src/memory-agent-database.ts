import { resolveOmnipolymathAgentSqlitePath } from "omnipolymath/plugin-sdk/sqlite-runtime";
import { resolveStateDir } from "omnipolymath/plugin-sdk/state-paths";

export function captureMemoryAgentDatabaseOptions(agentId: string) {
  const env = { ...process.env, OMNIPOLYMATH_STATE_DIR: resolveStateDir() };
  return { agentId, env, path: resolveOmnipolymathAgentSqlitePath({ agentId, env }) };
}

export function captureMemoryAgentReadTarget(
  options: Parameters<typeof resolveOmnipolymathAgentSqlitePath>[0],
) {
  return {
    agentId: options.agentId,
    databasePath: resolveOmnipolymathAgentSqlitePath(options),
    stateDir: resolveStateDir(options.env),
  };
}
