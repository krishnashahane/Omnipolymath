import path from "node:path";
import { afterAll, afterEach, assert, expect, it, vi } from "vitest";
import { createSnapshot } from "../config/mutate.test-support.js";
import { replaceSessionEntry } from "../config/sessions/session-accessor.js";
import { hashSystemAgentOperation } from "../system-agent/operator-approval.js";
import { withSystemAgentOverviewSources } from "../system-agent/overview.test-support.js";
import { useSessionStoreTempDirs } from "../test-utils/session-state-cleanup.js";
import { resolveToolsMcpAgentId } from "./agent-session-env.js";
import {
  buildSystemAgentToolsMcpServerConfig,
  OMNIPOLYMATH_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV as ARMED_ENV,
  OMNIPOLYMATH_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV as SURFACE_ENV,
  OMNIPOLYMATH_TOOLS_MCP_TOOLS_ENV as TOOLS_ENV,
  resolveOmnipolymathToolsMcpSystemAgentSurface as resolveSurface,
  resolveOmnipolymathToolsMcpToolSelection as resolveSelection,
} from "./omnipolymath-tools-serve-config.js";
import {
  OMNIPOLYMATH_TOOLS_MCP_AGENT_SESSION_KEY_ENV as SESSION_ENV,
  resolveOmnipolymathToolsForMcp,
} from "./omnipolymath-tools-serve.js";
import { createPluginToolsMcpHandlers } from "./plugin-tools-handlers.js";

const sessionDirs = useSessionStoreTempDirs(afterAll, "omnipolymath-mcp-subagent-policy-");

afterEach(() => vi.unstubAllEnvs());

async function handlersFor(params: Parameters<typeof resolveOmnipolymathToolsForMcp>[0]) {
  return createPluginToolsMcpHandlers(await resolveOmnipolymathToolsForMcp(params));
}

function serverConfig(options: Parameters<typeof buildSystemAgentToolsMcpServerConfig>[0]) {
  return buildSystemAgentToolsMcpServerConfig(options).mcpServers.omnipolymath as {
    args: string[];
    env?: Record<string, string>;
  };
}

async function propose(approvalArmed: boolean, configPath: string, value: string) {
  const server = serverConfig({
    surface: "cli",
    approvalArmed,
    operatorApprovalOnly: !approvalArmed,
    proposalRef: {
      current: hashSystemAgentOperation({ kind: "config-set", path: configPath, value }),
    },
  });
  for (const [key, envValue] of Object.entries(server.env ?? {})) {
    vi.stubEnv(key, envValue);
  }
  const handlers = await handlersFor({});
  return JSON.stringify(
    await handlers.callTool({
      name: "omnipolymath",
      arguments: { action: "config_set", path: configPath, value, approved: true },
    }),
  );
}

it("does not expose cron to a persisted sub-agent ACP session", async () => {
  const storePath = path.join(sessionDirs.make(), "sessions.json");
  const sessionKey = "agent:main:acp:resumed-child";
  await replaceSessionEntry(
    { storePath, sessionKey },
    {
      sessionId: `${sessionKey}-session`,
      updatedAt: Date.now(),
      spawnedBy: "agent:main:subagent:parent",
      spawnDepth: 2,
      subagentRole: "leaf",
      subagentControlScope: "none",
    },
  );
  vi.stubEnv(SESSION_ENV, sessionKey);
  const handlers = await handlersFor({ config: { session: { store: storePath } } });
  expect((await handlers.listTools()).tools.map((tool) => tool.name)).not.toContain("automations");
  for (const name of ["automations", "cron"]) {
    await expect(handlers.callTool({ name, arguments: { action: "status" } })).resolves.toEqual({
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    });
  }
});

it("passes the disabled cron trigger gate through MCP", async () => {
  vi.stubEnv(SESSION_ENV, "agent:worker:main");
  const [tool] = await resolveOmnipolymathToolsForMcp({
    config: { cron: { triggers: { enabled: false } } },
  });
  assert.isDefined(tool, "expected the automations tool to be resolved");
  expect(tool.parameters).not.toHaveProperty("properties.job.properties.trigger");
});

it("requires the managed bridge to pass a real agent session key", async () => {
  vi.stubEnv(SESSION_ENV, "");
  await expect(resolveOmnipolymathToolsForMcp()).rejects.toThrow(SESSION_ENV);
});

it("keeps the generated helper owner through MCP diagnostic actions", async () => {
  const server = serverConfig({ surface: "gateway", agentId: "work" });
  vi.stubEnv(TOOLS_ENV, server.env?.[TOOLS_ENV]);
  vi.stubEnv(SURFACE_ENV, server.env?.[SURFACE_ENV]);
  const handlers = await handlersFor({ agentId: resolveToolsMcpAgentId(server.args) });

  const result = await withSystemAgentOverviewSources(
    createSnapshot({
      sourceConfig: {
        agents: {
          ownership: "explicit",
          entries: { work: { model: "openai/gpt-5.6-luna" }, other: { model: "example/other" } },
        },
      },
    }),
    () => handlers.callTool({ name: "omnipolymath", arguments: { action: "models" } }),
  );

  expect(JSON.stringify(result)).toContain("Default model: openai/gpt-5.6-luna");
  expect(result.isError).not.toBe(true);
});

it("returns approved CLI MCP mutations to the host instead of applying them", async () => {
  expect(await propose(true, "gateway.port", "19001")).toContain("directive:approved-operation:");
});

it("parses the served tool selection from env and defaults to cron", () => {
  expect(resolveSelection({})).toEqual(["cron"]);
  expect(resolveSelection({ [TOOLS_ENV]: " omnipolymath , cron " })).toEqual(["omnipolymath", "cron"]);
  expect(() => resolveSelection({ [TOOLS_ENV]: "exec" })).toThrow(TOOLS_ENV);
});

it("parses the omnipolymath surface from env and defaults to cli", () => {
  expect(resolveSurface({})).toBe("cli");
  expect(resolveSurface({ [SURFACE_ENV]: "gateway" })).toBe("gateway");
  expect(() => resolveSurface({ [SURFACE_ENV]: "remote" })).toThrow(SURFACE_ENV);
});

it("omits approval state from an unarmed CLI MCP config", () => {
  expect(serverConfig({ surface: "cli" }).env).not.toHaveProperty(ARMED_ENV);
});

it("reconstructs delegated proposal staging from env on the native CLI MCP tool", async () => {
  const text = await propose(false, "agents.defaults.subagents.thinking", "high");
  expect(text).toContain("needs-approval:");
  expect(text).toContain("requesting session's permission policy");
  expect(text).toContain("returns the final outcome");
  expect(text).not.toContain("Omnipolymath operator UI");
  expect(text).not.toContain("ask the user to reply yes");
});
