import path from "node:path";
import {
  resolveIncognitoOmnipolymathAgentSqlitePath,
  resolveOmnipolymathAgentSqlitePath,
} from "./omnipolymath-agent-db.paths.js";

/** Recovery also inventories disk collisions at the reserved incognito filename. */
export function resolveOmnipolymathAgentDatabaseDiscoveryPaths(params: {
  agentDir: string;
  agentId: string;
  env: NodeJS.ProcessEnv;
}): string[] {
  return [
    resolveOmnipolymathAgentSqlitePath(params),
    resolveIncognitoOmnipolymathAgentSqlitePath(params),
  ].map((pathname) => path.join(params.agentDir, path.basename(pathname)));
}
