import { normalizeAgentId, parseAgentSessionKey } from "../routing/session-key.js";

export const OMNIPOLYMATH_TOOLS_MCP_AGENT_SESSION_KEY_ENV = "OMNIPOLYMATH_TOOLS_MCP_AGENT_SESSION_KEY";

/** Private generated-helper argv selects context, never approval or execution authority. */
export function resolveToolsMcpAgentId(
  argv: readonly string[] = process.argv.slice(2),
): string | undefined {
  const index = argv.indexOf("--omnipolymath-agent-id");
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith("--") || argv.includes("--omnipolymath-agent-id", index + 1)) {
    throw new Error("--omnipolymath-agent-id requires one Omnipolymath agent owner");
  }
  return normalizeAgentId(value);
}

export function resolveToolsMcpSessionContext(params: {
  agentSessionKey?: string;
  agentId?: string;
}): { sessionKey?: string; agentId?: string } {
  const sessionKey = (params.agentSessionKey ?? resolveToolsMcpAgentSessionKey())?.trim();
  const encodedOwner = sessionKey ? parseAgentSessionKey(sessionKey)?.agentId : undefined;
  const agentId = params.agentId?.trim() ? normalizeAgentId(params.agentId) : encodedOwner;
  if (
    (sessionKey && !agentId) ||
    (encodedOwner && encodedOwner !== agentId) ||
    (!sessionKey && agentId)
  ) {
    throw new Error(
      `${OMNIPOLYMATH_TOOLS_MCP_AGENT_SESSION_KEY_ENV} must be a canonical agent session key or have a matching explicit Omnipolymath owner`,
    );
  }
  return sessionKey ? { sessionKey, agentId } : {};
}

export function resolveToolsMcpAgentSessionKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env[OMNIPOLYMATH_TOOLS_MCP_AGENT_SESSION_KEY_ENV]?.trim() || undefined;
}
