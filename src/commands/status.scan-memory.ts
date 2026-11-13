// Runtime memory dependencies stay lazy so status paths without memory avoid loading the search manager.

import { resolveMemorySearchConfig } from "../agents/memory-search.js";
import type { OmnipolymathConfig } from "../config/types.js";
import { resolveOmnipolymathAgentSqlitePath } from "../state/omnipolymath-agent-db.paths.js";
import type { MemoryPluginStatus } from "../status/memory-plugin.js";
import type { AgentLocalStatusesResult } from "./status.agent-local.js";
import {
  resolveSharedMemoryStatusSnapshot,
  type MemoryStatusSnapshot,
} from "./status.scan.shared.js";

/** Returns the owning agent database path for built-in memory. */
export function resolveDefaultMemoryDatabasePath(agentId: string): string {
  return resolveOmnipolymathAgentSqlitePath({ agentId });
}

/** Resolves memory index/cache status for the current status scan. */
export async function resolveStatusMemoryStatusSnapshot(params: {
  cfg: OmnipolymathConfig;
  agentStatus: Pick<AgentLocalStatusesResult, "defaultId">;
  memoryPlugin: MemoryPluginStatus;
  requireDefaultDatabasePath?: (agentId: string) => string;
}): Promise<MemoryStatusSnapshot | null> {
  const { getMemoryProvider, isMemoryProviderNative } =
    await import("./status.scan.deps.runtime.js");
  return await resolveSharedMemoryStatusSnapshot({
    cfg: params.cfg,
    agentStatus: params.agentStatus,
    memoryPlugin: params.memoryPlugin,
    resolveMemoryConfig: resolveMemorySearchConfig,
    getMemoryProvider,
    isMemoryProviderNative,
    requireDefaultDatabasePath: params.requireDefaultDatabasePath,
  });
}
