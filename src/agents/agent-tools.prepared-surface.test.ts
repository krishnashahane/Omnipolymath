import { expectDefined } from "@omnipolymath/normalization-core";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import "./test-helpers/fast-bash-tools.js";
import "./test-helpers/fast-coding-tools.js";
import "./test-helpers/fast-omnipolymath-tools.js";
import { createWorkerPlacementTools } from "../worker/worker-placement-tools.js";
import { createOmnipolymathCodingToolsInternalAsync } from "./agent-tools.async.js";
import { createOmnipolymathCodingToolsInternal as buildTools } from "./agent-tools.js";
import { runWithAgentRingZeroTools } from "./agent-tools.ring-zero-context.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import * as coreCodingTools from "./core-coding-tools.js";
import * as pluginTools from "./omnipolymath-plugin-tools.js";
import { createOmnipolymathTools } from "./omnipolymath-tools.js";
import { prepareCoreToolPolicy, projectAgentToolDefinition } from "./prepared-tool-surface.js";
import { createStubTool } from "./test-helpers/agent-tool-stubs.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => vi.restoreAllMocks());
const baseOptions = (omnipolymath = false, deny: string[] = []) => ({
  workspaceDir: tempDirs.make("prepared-surface-"),
  config: omnipolymath ? {} : { tools: { exec: { host: "gateway" as const }, deny } },
  wrapBeforeToolCallHook: false,
  toolConstructionPlan: {
    includeBaseCodingTools: !omnipolymath,
    includeShellTools: !omnipolymath,
    includeChannelTools: false,
    includeOmnipolymathTools: omnipolymath,
    includePluginTools: false,
  },
});

it.each([buildTools, createOmnipolymathCodingToolsInternalAsync])(
  "does not construct globally denied tools and retains host-owned tools (%#)",
  async (build) => {
    const core = vi.spyOn(coreCodingTools, "createCoreCodingTools");
    const plugin = vi
      .spyOn(pluginTools, "resolveOmnipolymathPluginToolsForOptions")
      .mockReturnValue([]);
    const pluginAsync = vi
      .spyOn(pluginTools, "resolveOmnipolymathPluginToolsForOptionsAsync")
      .mockResolvedValue([]);
    vi.mocked(createOmnipolymathTools).mockClear();
    const host = createStubTool("host_ping");
    const options = {
      workspaceDir: tempDirs.make("denied-tools-"),
      config: { tools: { deny: ["*"] } },
      forceMessageTool: true,
    };
    const tools = await runWithAgentRingZeroTools([host], () => build(options));
    expect(tools.map((tool) => tool.name)).toEqual([host.name]);
    expect(await build({ ...options, includeCoreTools: false })).toEqual([]);
    expect(core.mock.calls.length).toBe(0);
    expect(vi.mocked(createOmnipolymathTools).mock.calls.length).toBe(0);
    expect(plugin.mock.calls.length).toBe(0);
    expect(pluginAsync.mock.calls.length).toBe(0);
  },
);

it.each([false, true])(
  "preserves local definition bytes and policy for placement (deny process=%s)",
  (denyProcess) => {
    const construct = vi.spyOn(coreCodingTools, "createCoreCodingTools");
    const options = baseOptions(false, ["write", ...(denyProcess ? ["process"] : [])]);
    const local = buildTools(options);
    const policy = prepareCoreToolPolicy(options);
    const prepared = createWorkerPlacementTools({
      policy,
      cwd: options.workspaceDir,
      containmentRoot: options.workspaceDir,
      execAuthority: { host: "gateway", security: "full", ask: "off" },
      agentId: "main",
      sessionKey: "worker:prepared",
      sessionId: "prepared",
      runId: "run-prepared",
    });
    expect(prepared.map((tool) => tool.name)).toContain("write");
    const placed = buildTools(options, undefined, undefined, { tools: prepared, policy });
    expect(construct).toHaveBeenCalledTimes(2);
    expect(placed.map((tool) => tool.name)).not.toContain("write");
    expect(JSON.stringify(placed.map(projectAgentToolDefinition))).toBe(
      JSON.stringify(local.map(projectAgentToolDefinition)),
    );
  },
);

it("retains Gateway tools while replacing a placed session tool's schema and execution", async () => {
  const options = baseOptions(true);
  const result = { content: [], details: { childSessionKey: "placed-child" } };
  const execute = vi.fn<AnyAgentTool["execute"]>().mockResolvedValue(result);
  const adapter: AnyAgentTool = {
    name: "sessions_spawn",
    label: "Placed spawn",
    description: "Create a placed child",
    parameters: { type: "object", properties: { task: { type: "string" } }, required: ["task"] },
    execute,
  };
  const replacement = { tools: [adapter], policy: prepareCoreToolPolicy(options) };
  const tools = buildTools(options, undefined, undefined, replacement);
  const names = tools.map((tool) => tool.name);
  expect(names).toContain("web_fetch");
  expect(names).toContain("sessions_list");
  expect(names.filter((name) => name === "sessions_spawn")).toHaveLength(1);
  const spawn = expectDefined(
    tools.find((tool) => tool.name === "sessions_spawn"),
    "placed spawn",
  );
  expect(spawn.parameters).toMatchObject(adapter.parameters);
  expect(spawn.parameters).not.toHaveProperty("properties.action");
  await expect(spawn.execute("spawn-placed", { task: "synthetic task" })).resolves.toEqual(result);
  expect(execute).toHaveBeenCalledExactlyOnceWith("spawn-placed", { task: "synthetic task" });
});
