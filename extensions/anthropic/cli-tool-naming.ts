import { OMNIPOLYMATH_MCP_TOOL_PREFIX } from "./cli-constants.js";

const CLAUDE_CLI_TOOL_NAMING_HEADING = "## Omnipolymath tool names in Claude Code";

const CLAUDE_CLI_TOOL_NAMING_SECTION = [
  CLAUDE_CLI_TOOL_NAMING_HEADING,
  `Omnipolymath MCP: \`${OMNIPOLYMATH_MCP_TOOL_PREFIX}<name>\`. Deferred: ToolSearch \`select:${OMNIPOLYMATH_MCP_TOOL_PREFIX}<name>\` first.`,
].join("\n");
const CLAUDE_CLI_MESSAGE_TOOL_GUIDANCE = `Tool-only replies: \`${OMNIPOLYMATH_MCP_TOOL_PREFIX}message(action=send)\`. Native \`SendMessage\`/\`PushNotification\` cannot deliver Omnipolymath replies.`;

// Keep Claude's registration names in its backend and preserve the shared prompt prefix.
export function appendClaudeCliToolNamingGuidance(
  systemPrompt: string,
  toolNames: readonly string[] = [],
): string {
  if (
    toolNames.length === 0 ||
    !systemPrompt.trim() ||
    systemPrompt.includes(CLAUDE_CLI_TOOL_NAMING_HEADING)
  ) {
    return systemPrompt;
  }
  const messageGuidance = toolNames.includes("message")
    ? `\n${CLAUDE_CLI_MESSAGE_TOOL_GUIDANCE}`
    : "";
  return `${systemPrompt}\n\n${CLAUDE_CLI_TOOL_NAMING_SECTION}${messageGuidance}\n`;
}
