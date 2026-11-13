/**
 * Shared contract between the omnipolymath-tools MCP stdio entry and the callers
 * that inject it into CLI harness runs. Keep this module free of MCP SDK and
 * tool-runtime imports so CLI-runner prepare paths can build server configs
 * without loading the server.
 */
import { normalizeCsvOrLooseStringList } from "@omnipolymath/normalization-core/string-normalization";
import type { SystemAgentToolOptions } from "../agents/tools/system-agent-tool.js";
import { resolveOmnipolymathPackageRootSync } from "../infra/omnipolymath-root.js";
import { resolvePackageRuntimeProcessEntrypointUrl } from "../infra/runtime-process-package-url.js";
import { resolveRuntimeWorkerArgv } from "../infra/runtime-worker-url.js";
import type { BundleMcpConfig } from "../plugins/bundle-mcp.types.js";

export const OMNIPOLYMATH_TOOLS_MCP_TOOLS_ENV = "OMNIPOLYMATH_TOOLS_MCP_TOOLS";
export const OMNIPOLYMATH_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV =
  "OMNIPOLYMATH_TOOLS_MCP_SYSTEM_AGENT_SURFACE";
export const OMNIPOLYMATH_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV =
  "OMNIPOLYMATH_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED";
export const OMNIPOLYMATH_TOOLS_MCP_SYSTEM_AGENT_PROPOSAL_ENV =
  "OMNIPOLYMATH_TOOLS_MCP_SYSTEM_AGENT_PROPOSAL";
// Delegation and chat consent are mutually exclusive. Keep both in the existing
// per-turn transport value so native transcript resume identity stays stable.
const APPROVAL_ARMED_OPERATOR_ONLY_VALUE = "operator-only";

const OMNIPOLYMATH_TOOLS_MCP_TOOL_IDS = ["cron", "omnipolymath"] as const;
export type OmnipolymathToolsMcpToolId = (typeof OMNIPOLYMATH_TOOLS_MCP_TOOL_IDS)[number];

function isOmnipolymathToolsMcpToolId(value: string): value is OmnipolymathToolsMcpToolId {
  return (OMNIPOLYMATH_TOOLS_MCP_TOOL_IDS as readonly string[]).includes(value);
}

/** Parse the served tool selection; the default stays cron for acpx bridges. */
export function resolveOmnipolymathToolsMcpToolSelection(
  env: NodeJS.ProcessEnv = process.env,
): OmnipolymathToolsMcpToolId[] {
  const raw = env[OMNIPOLYMATH_TOOLS_MCP_TOOLS_ENV]?.trim();
  if (!raw) {
    return ["cron"];
  }
  const entries = normalizeCsvOrLooseStringList(raw);
  const selection = entries.filter(isOmnipolymathToolsMcpToolId);
  if (selection.length === 0 || selection.length !== entries.length) {
    throw new Error(
      `${OMNIPOLYMATH_TOOLS_MCP_TOOLS_ENV} must be a comma list of: ${OMNIPOLYMATH_TOOLS_MCP_TOOL_IDS.join(", ")}`,
    );
  }
  return selection;
}

/** Parse the Omnipolymath surface for served omnipolymath tools; defaults to cli. */
export function resolveOmnipolymathToolsMcpSystemAgentSurface(
  env: NodeJS.ProcessEnv = process.env,
): SystemAgentToolOptions["surface"] {
  const raw = env[OMNIPOLYMATH_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV]?.trim();
  if (!raw || raw === "cli") {
    return "cli";
  }
  if (raw === "gateway") {
    return "gateway";
  }
  throw new Error(`${OMNIPOLYMATH_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV} must be "cli" or "gateway"`);
}

/**
 * Reconstruct per-turn approval state for the served omnipolymath tool. The
 * stdio server runs out of process, so the host passes the armed bit and the
 * pending proposal hash through env; the host mirrors transitions back from
 * tool events (see mirrorSystemAgentToolStateFromEvents in agent-turn.ts).
 */
export function resolveOmnipolymathToolsMcpSystemAgentApproval(env: NodeJS.ProcessEnv = process.env): {
  approvalArmed: boolean;
  proposalRef: { current?: string };
  operatorApprovalOnly?: boolean;
} {
  const pendingProposal = env[OMNIPOLYMATH_TOOLS_MCP_SYSTEM_AGENT_PROPOSAL_ENV]?.trim();
  const armedValue = env[OMNIPOLYMATH_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV]?.trim();
  return {
    approvalArmed: armedValue === "1",
    proposalRef: pendingProposal ? { current: pendingProposal } : {},
    ...(armedValue === APPROVAL_ARMED_OPERATOR_ONLY_VALUE ? { operatorApprovalOnly: true } : {}),
  };
}

function resolveOmnipolymathToolsServeCommand(): { command: string; args: string[] } {
  const packageRoot = resolveOmnipolymathPackageRootSync({
    argv1: process.argv[1],
    moduleUrl: import.meta.url,
    cwd: process.cwd(),
  });
  if (!packageRoot) {
    throw new Error("omnipolymath-tools MCP: could not resolve the Omnipolymath package root");
  }
  return {
    command: process.execPath,
    args: resolveRuntimeWorkerArgv(
      resolvePackageRuntimeProcessEntrypointUrl("omnipolymathToolsServe", packageRoot),
    ),
  };
}

/**
 * Omnipolymath CLI-harness runs get exactly one MCP server: this stdio entry
 * serving the ring-zero omnipolymath tool. The server keeps the "omnipolymath" name
 * so backend tool pre-approvals (e.g. Claude's --allowedTools mcp__omnipolymath__*)
 * apply without per-backend argument surgery.
 */
export function buildSystemAgentToolsMcpServerConfig(
  options: SystemAgentToolOptions,
): BundleMcpConfig {
  const entry = resolveOmnipolymathToolsServeCommand();
  const pendingProposal = options.proposalRef?.current;
  return {
    mcpServers: {
      omnipolymath: {
        command: entry.command,
        args: options.agentId
          ? [...entry.args, "--omnipolymath-agent-id", options.agentId]
          : entry.args,
        env: {
          [OMNIPOLYMATH_TOOLS_MCP_TOOLS_ENV]: "omnipolymath" satisfies OmnipolymathToolsMcpToolId,
          [OMNIPOLYMATH_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV]: options.surface,
          // Per-turn approval state travels with the per-run MCP config; the
          // host mirrors proposal transitions back from tool events.
          ...(options.operatorApprovalOnly === true
            ? {
                [OMNIPOLYMATH_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV]:
                  APPROVAL_ARMED_OPERATOR_ONLY_VALUE,
              }
            : options.approvalArmed === true
              ? { [OMNIPOLYMATH_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV]: "1" }
              : {}),
          ...(pendingProposal
            ? { [OMNIPOLYMATH_TOOLS_MCP_SYSTEM_AGENT_PROPOSAL_ENV]: pendingProposal }
            : {}),
        },
      },
    },
  };
}
