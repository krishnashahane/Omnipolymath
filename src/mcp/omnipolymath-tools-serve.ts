/**
 * Standalone MCP server for selected built-in Omnipolymath tools.
 *
 * Run via: node --import tsx src/mcp/omnipolymath-tools-serve.ts
 * Or: bun src/mcp/omnipolymath-tools-serve.ts
 */
import { pathToFileURL } from "node:url";
import { resolveRequesterToolPolicies } from "../agents/requester-tool-policy.js";
import { withPreparedSessionCapabilityRead } from "../agents/subagents/spawn/subagent-session-store.js";
import { isToolAllowedByPolicies } from "../agents/tool-policy-match.js";
import { AUTOMATIONS_TOOL_NAME } from "../agents/tools/automations-tool-name.js";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { createCronTool } from "../agents/tools/cron-tool.js";
import { createSystemAgentTool } from "../agents/tools/system-agent-tool.js";
import { captureRuntimeConfigAsyncReader, getRuntimeConfig } from "../config/config.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { formatErrorMessage } from "../infra/errors.js";
import {
  OMNIPOLYMATH_TOOLS_MCP_AGENT_SESSION_KEY_ENV,
  resolveToolsMcpAgentSessionKey as resolveOmnipolymathToolsMcpAgentSessionKey,
  resolveToolsMcpAgentId,
  resolveToolsMcpSessionContext,
} from "./agent-session-env.js";
import {
  resolveOmnipolymathToolsMcpSystemAgentApproval,
  resolveOmnipolymathToolsMcpSystemAgentSurface,
  resolveOmnipolymathToolsMcpToolSelection,
} from "./omnipolymath-tools-serve-config.js";
import { connectToolsMcpServerToStdio, createToolsMcpServer } from "./tools-stdio-server.js";

export {
  OMNIPOLYMATH_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV,
  OMNIPOLYMATH_TOOLS_MCP_TOOLS_ENV,
} from "./omnipolymath-tools-serve-config.js";

export { OMNIPOLYMATH_TOOLS_MCP_AGENT_SESSION_KEY_ENV } from "./agent-session-env.js";

export async function resolveOmnipolymathToolsForMcp(
  params: {
    agentId?: string;
    config?: OmnipolymathConfig;
  } = {},
): Promise<AnyAgentTool[]> {
  const selection = resolveOmnipolymathToolsMcpToolSelection();
  const agentSessionKey = resolveOmnipolymathToolsMcpAgentSessionKey();
  const tools = selection.map((tool) => {
    if (tool === "omnipolymath") {
      return createSystemAgentTool({
        agentId: params.agentId,
        surface: resolveOmnipolymathToolsMcpSystemAgentSurface(),
        ...resolveOmnipolymathToolsMcpSystemAgentApproval(),
      });
    }
    if (!agentSessionKey) {
      throw new Error(`${OMNIPOLYMATH_TOOLS_MCP_AGENT_SESSION_KEY_ENV} is required`);
    }
    const context = resolveToolsMcpSessionContext({ agentSessionKey, agentId: params.agentId });
    return createCronTool({
      agentSessionKey,
      agentId: context.agentId,
      // Same host-config resolution as plugin-tools-serve: the advertised cron
      // surface must reflect this deployment's cron.triggers.enabled gate.
      config: params.config ?? getRuntimeConfig(),
      creatorToolAllowlist: [{ name: AUTOMATIONS_TOOL_NAME }],
    });
  });
  if (!agentSessionKey) {
    return tools;
  }
  const requesterPolicies = await withPreparedSessionCapabilityRead(() =>
    resolveRequesterToolPolicies({
      config: params.config ?? getRuntimeConfig(),
      agentId: params.agentId,
      sessionKey: agentSessionKey,
      senderPolicyMode: "never",
    }),
  );
  return tools.filter((tool) =>
    isToolAllowedByPolicies(tool.name, [
      requesterPolicies.groupPolicy,
      requesterPolicies.senderPolicy,
      requesterPolicies.subagentPolicy,
      requesterPolicies.inheritedToolPolicy,
    ]),
  );
}

async function serveOmnipolymathToolsMcp(): Promise<void> {
  const server = createToolsMcpServer({
    name: "omnipolymath-tools",
    tools: await resolveOmnipolymathToolsForMcp({
      agentId: resolveToolsMcpAgentId(),
      config: await captureRuntimeConfigAsyncReader()(),
    }),
  });
  await connectToolsMcpServerToStdio(server);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  serveOmnipolymathToolsMcp().catch((err: unknown) => {
    process.stderr.write(`omnipolymath-tools-serve: ${formatErrorMessage(err)}\n`);
    process.exitCode = 1;
  });
}
