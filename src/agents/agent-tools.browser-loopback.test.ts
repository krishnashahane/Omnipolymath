import { describe, expect, it, onTestFinished, vi } from "vitest";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../config/config.js";
import * as execApprovalsStore from "../infra/exec-approvals-store.js";
import * as execApprovals from "../infra/exec-approvals.js";
import "./test-helpers/fast-bash-tools.js";
import "./test-helpers/fast-coding-tools.js";
import "./test-helpers/fast-omnipolymath-tools.js";
import {
  createOmnipolymathCodingTools,
  createOmnipolymathCodingToolsInternal,
  createOmnipolymathCodingToolsInternalAsync,
} from "./agent-tools.js";
import * as omnipolymathPluginTools from "./omnipolymath-plugin-tools.js";
import { createOmnipolymathTools } from "./omnipolymath-tools.js";
import { resolveOmnipolymathPluginToolInputs } from "./omnipolymath-tools.plugin-context.js";
import { createAgentToolsSandboxContext } from "./test-helpers/agent-tools-sandbox-context.js";
import { createHostSandboxFsBridge } from "./test-helpers/host-sandbox-fs-bridge.js";

describe("assembled browser loopback authority", () => {
  type Options = NonNullable<Parameters<typeof createOmnipolymathCodingTools>[0]>;
  const full: Options = { sessionPermissionPolicy: { root: "/workspace", mode: "full" } };
  const denied: Options = { config: { tools: { deny: ["exec"] } } };
  const sandbox: Options = {
    sandbox: createAgentToolsSandboxContext({
      workspaceDir: "/workspace",
      fsBridge: createHostSandboxFsBridge("/workspace"),
      browserAllowHostControl: true,
    }),
  };
  const deployment = (allow: string[], exec?: string[]): Options => ({
    config: {
      tools: {
        gatewayPolicy: { allow, actions: { browser: ["open", "navigate"], ...(exec && { exec }) } },
      },
    },
  });
  const policyCase = (
    name: string,
    options: Options = {},
    allowed = false,
    approvals?: execApprovals.ExecApprovalsFile,
  ) => ({ name, options, allowed, approvals });
  const browserLoopbackCases = [
    policyCase("unrestricted local execution", {}, true),
    policyCase("explicit empty browser policy", { config: { browser: { ssrfPolicy: {} } } }),
    policyCase("explicit full session over host approval floors", full, true, {
      version: 1,
      defaults: { security: "deny", ask: "always" },
      agents: {},
    }),
    policyCase("sandbox with host browser control", sandbox),
    policyCase("workspace session", {
      sessionPermissionPolicy: { root: "/workspace", mode: "workspace" },
    }),
    policyCase("workspace-only filesystem", { requireWorkspaceOnly: true }),
    policyCase("node execution", { exec: { host: "node" } }),
    policyCase("exec allowlist", { exec: { security: "allowlist" } }),
    policyCase("full session tightened by exec override", {
      ...full,
      exec: { security: "allowlist" },
    }),
    policyCase("host approval floor", {}, false, {
      version: 1,
      defaults: { security: "allowlist" },
      agents: {},
    }),
    policyCase("exec approval requirement", { exec: { security: "full", ask: "always" } }),
    policyCase("scheduled approval requirement", {
      ...full,
      scheduledToolPolicy: {
        version: 1,
        mode: "trusted",
        execTarget: { host: "gateway", ask: "always" },
      },
    }),
    policyCase("denied exec tool", denied),
    policyCase("deployment permits Browser but withholds exec", deployment(["browser"])),
    policyCase("deployment permits Browser and exec", deployment(["browser", "exec"]), true),
    policyCase(
      "deployment withholds exec through an empty action list",
      deployment(["browser", "exec"], []),
    ),
    policyCase("inherited runtime tool ceiling", {
      runtimeToolAllowlist: ["browser"],
      inheritRuntimeToolAllowlist: true,
    }),
  ];

  function mockAsyncAssembly() {
    const read = vi.spyOn(execApprovalsStore, "prepareExecApprovalsCurrentRead");
    const plugins = vi
      .spyOn(omnipolymathPluginTools, "resolveOmnipolymathPluginToolsForOptionsAsync")
      .mockResolvedValue([]);
    onTestFinished(() => {
      plugins.mockRestore();
      read.mockRestore();
    });
    return read;
  }

  it("keeps ordinary tools usable when the optional preview policy owner is unavailable", async () => {
    mockAsyncAssembly().mockRejectedValue(new Error("synthetic unavailable policy owner"));
    const tools = await createOmnipolymathCodingToolsInternalAsync();
    expect(tools.some((tool) => tool.name === "browser")).toBe(true);
    const options = vi.mocked(createOmnipolymathTools).mock.calls.at(-1)?.[0];
    expect(options?.allowLocalBrowserLoopback).toBe(false);
  });

  it("retires the preview grant when config changes while policy preparation awaits", async () => {
    const config = {};
    const explicitPolicy = { browser: { ssrfPolicy: {} } };
    setRuntimeConfigSnapshot(config);
    mockAsyncAssembly().mockImplementation(async () => {
      setRuntimeConfigSnapshot(explicitPolicy);
      return () => ({ version: 1, defaults: { security: "full", ask: "off" } });
    });
    try {
      await createOmnipolymathCodingToolsInternalAsync({ config });
      expect(vi.mocked(createOmnipolymathTools).mock.calls.at(-1)?.[0]?.allowLocalBrowserLoopback).toBe(
        false,
      );
    } finally {
      clearRuntimeConfigSnapshot();
    }
  });

  it.each(browserLoopbackCases)(
    "prepares browser loopback capability for $name on both assembly paths",
    ({ options, approvals, allowed }) => {
      const loadApprovals = vi
        .spyOn(execApprovals, "loadExecApprovals")
        .mockReturnValue(
          approvals ?? { version: 1, defaults: { security: "full", ask: "off" }, agents: {} },
        );
      const plugins = vi
        .spyOn(omnipolymathPluginTools, "resolveOmnipolymathPluginToolsForOptions")
        .mockReturnValue([]);
      try {
        for (const pluginOnly of [false, true]) {
          vi.mocked(createOmnipolymathTools).mockClear();
          plugins.mockClear();
          createOmnipolymathCodingTools({
            ...options,
            ...(pluginOnly
              ? {
                  toolConstructionPlan: {
                    includeBaseCodingTools: false,
                    includeShellTools: false,
                    includeChannelTools: false,
                    includeOmnipolymathTools: false,
                    includePluginTools: true,
                  },
                }
              : {}),
          });
          const preparedOptions = pluginOnly
            ? plugins.mock.calls.at(-1)?.[0].options
            : vi.mocked(createOmnipolymathTools).mock.calls.at(-1)?.[0];
          const { context } = resolveOmnipolymathPluginToolInputs({ options: preparedOptions });
          expect(context.browser.allowLocalLoopback).toBe(allowed);
        }
      } finally {
        plugins.mockRestore();
        loadApprovals.mockRestore();
      }
    },
  );

  it("preserves independently authorized native execution when deployment withholds exec", () => {
    const loadApprovals = vi
      .spyOn(execApprovals, "loadExecApprovals")
      .mockReturnValue({ version: 1, defaults: { security: "full", ask: "off" }, agents: {} });
    const plugins = vi
      .spyOn(omnipolymathPluginTools, "resolveOmnipolymathPluginToolsForOptions")
      .mockReturnValue([]);
    try {
      vi.mocked(createOmnipolymathTools).mockClear();
      createOmnipolymathCodingToolsInternal({
        ...deployment(["browser"]),
        nativeHarnessExecution: true,
      });
      const { context } = resolveOmnipolymathPluginToolInputs({
        options: vi.mocked(createOmnipolymathTools).mock.calls.at(-1)?.[0],
      });
      expect(context.browser.allowLocalLoopback).toBe(true);
    } finally {
      plugins.mockRestore();
      loadApprovals.mockRestore();
    }
  });
});
