import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePreparedExecEnvironment } from "../agents/bash-tools.exec-request-preparation.js";
import { createExecTool } from "../agents/bash-tools.js";
import { resolveExecToolConfig } from "../agents/lazy-exec-tool.js";
import { quoteCliArg } from "../cli/quote-cli-arg.js";
import { captureEnv, withEnvAsync } from "../test-utils/env.js";
import { withTempDir } from "../test-utils/temp-dir.js";
import { withMockedWindowsPlatform } from "../test-utils/vitest-spies.js";
import * as cliInvocation from "./omnipolymath-cli-invocation.js";
import {
  createSourceCliFixture,
  runSourceCliProbe,
  withSourceCliParent,
} from "./omnipolymath-cli-invocation.test-support.js";
import { clearGatewayAgentCliShim, prepareGatewayAgentCliShim } from "./omnipolymath-cli-shim.js";

const envSnapshot = captureEnv([
  "OMNIPOLYMATH_EXEC_SHELL_SNAPSHOT",
  "OMNIPOLYMATH_PROFILE",
  "PATH",
  "TSX_TSCONFIG_PATH",
  "TSX_DISABLE_CACHE",
]);

afterEach(() => {
  vi.restoreAllMocks();
  clearGatewayAgentCliShim();
  envSnapshot.restore();
});

function readExecText(result: Awaited<ReturnType<ReturnType<typeof createExecTool>["execute"]>>) {
  return result.content.find((entry) => entry.type === "text")?.text?.trim() ?? "";
}
function execConfig(pathPrepend?: string[]) {
  return resolveExecToolConfig({ cfg: { tools: { exec: { pathPrepend } } } });
}

describe.skipIf(process.platform === "win32")("Gateway agent CLI shim", () => {
  it("runs the source CLI version command outside the checkout", () =>
    withTempDir("omnipolymath-agent-cli-version-", async (root) => {
      const checkout = fileURLToPath(new URL("../../", import.meta.url));
      const entryPath = path.join(checkout, "src", "entry.ts");
      const callerCwd = path.join(root, "workspace");
      const stateDir = path.join(root, "state");
      await fs.mkdir(callerCwd);
      const env = {
        HOME: root,
        USERPROFILE: root,
        OMNIPOLYMATH_PROFILE: "",
        OMNIPOLYMATH_STATE_DIR: stateDir,
        OMNIPOLYMATH_CONFIG_PATH: path.join(stateDir, "omnipolymath.json"),
      };
      const parent = { entryPath, execArgv: ["--import", "tsx"] };
      await withEnvAsync(env, () => withSourceCliParent(parent, prepareGatewayAgentCliShim));
      const bin = path.join(stateDir, "tmp", "agent-cli");
      const result = runSourceCliProbe(path.join(bin, "omnipolymath"), ["--version"], callerCwd, {
        env,
      });
      expect(result).toMatchObject({ status: 0, stdout: expect.stringMatching(/^Omnipolymath \d+\./) });
    }));

  it.each([
    { profile: "work", expectedArgs: ["--profile", "work", "probe"] },
    { profile: undefined, expectedArgs: ["probe"] },
  ])("pins the running CLI before configured PATH entries (profile=$profile)", (testCase) =>
    withTempDir("omnipolymath-agent-cli-shim-", async (root) => {
      const fixture = await createSourceCliFixture(root);
      const staleBinDir = path.join(root, "stale-bin");
      const staleCliPath = path.join(staleBinDir, "omnipolymath");
      const stateDir = path.join(root, "state");
      await fs.mkdir(staleBinDir, { recursive: true });
      await fs.writeFile(staleCliPath, "#!/bin/sh\nprintf '%s\\n' '{\"source\":\"stale\"}'\n", {
        mode: 0o700,
      });

      await withEnvAsync({ OMNIPOLYMATH_STATE_DIR: stateDir, OMNIPOLYMATH_PROFILE: testCase.profile }, () =>
        withSourceCliParent(fixture, prepareGatewayAgentCliShim),
      );
      const shimBinDir = path.join(stateDir, "tmp", "agent-cli");
      const config = execConfig([staleBinDir]);

      process.env.OMNIPOLYMATH_EXEC_SHELL_SNAPSHOT = "0";
      process.env.PATH = `${staleBinDir}${path.delimiter}${process.env.PATH ?? ""}`;
      delete process.env.OMNIPOLYMATH_PROFILE;
      delete process.env.TSX_TSCONFIG_PATH;
      process.env.TSX_DISABLE_CACHE = "1";
      const tool = createExecTool({
        ...config,
        host: "gateway",
        security: "full",
        ask: "off",
        cwd: fixture.callerCwd,
        notifyOnExit: false,
      });
      const result = await tool.execute("gateway-cli-version-probe", {
        command: "omnipolymath probe",
        yieldMs: 120_000,
      });
      expect(JSON.parse(readExecText(result))).toMatchObject({
        source: "gateway",
        args: testCase.expectedArgs,
        cwd: fixture.callerCwd,
        pathHead: shimBinDir,
      });
    }),
  );

  it("renders an upgrade-stable Homebrew interpreter into the launcher", () =>
    withTempDir("omnipolymath-agent-cli-shim-brew-", async (root) => {
      const cellarNode = path.join(root, "Cellar", "node", "26.8.2", "bin", "node");
      const stableNode = path.join(root, "opt", "node", "bin", "node");
      for (const interpreter of [cellarNode, stableNode]) {
        await fs.mkdir(path.dirname(interpreter), { recursive: true });
        await fs.writeFile(interpreter, "", "utf8");
      }
      vi.spyOn(cliInvocation, "resolveCurrentOmnipolymathCliInvocation").mockReturnValue({
        command: cellarNode,
        args: [path.join(root, "dist", "index.js")],
        cwd: root,
      });

      const stateDir = path.join(root, "state");
      await withEnvAsync(
        { OMNIPOLYMATH_STATE_DIR: stateDir, OMNIPOLYMATH_PROFILE: "" },
        prepareGatewayAgentCliShim,
      );

      const shim = await fs.readFile(path.join(stateDir, "tmp", "agent-cli", "omnipolymath"), "utf8");
      expect(shim).toContain(`exec ${quoteCliArg(stableNode)} `);
      expect(shim).not.toContain("Cellar");
    }));

  it("keeps the resolved interpreter when no stable Homebrew path exists", () =>
    withTempDir("omnipolymath-agent-cli-shim-brew-keg-", async (root) => {
      const cellarNode = path.join(root, "Cellar", "node", "26.8.2", "bin", "node");
      await fs.mkdir(path.dirname(cellarNode), { recursive: true });
      await fs.writeFile(cellarNode, "", "utf8");
      vi.spyOn(cliInvocation, "resolveCurrentOmnipolymathCliInvocation").mockReturnValue({
        command: cellarNode,
        args: [path.join(root, "dist", "index.js")],
        cwd: root,
      });

      const stateDir = path.join(root, "state");
      await withEnvAsync(
        { OMNIPOLYMATH_STATE_DIR: stateDir, OMNIPOLYMATH_PROFILE: "" },
        prepareGatewayAgentCliShim,
      );

      const shim = await fs.readFile(path.join(stateDir, "tmp", "agent-cli", "omnipolymath"), "utf8");
      expect(shim).toContain(`exec ${quoteCliArg(cellarNode)} `);
    }));
});

it.each([
  { configured: undefined, expectedWarnings: [] },
  {
    configured: ["/opt/operator/bin"],
    expectedWarnings: [
      "Warning: tools.exec.pathPrepend is ignored for host=node. Configure PATH on the node host/service instead.",
    ],
  },
])(
  "warns about node-host pathPrepend only for operator entries (configured=$configured)",
  ({ configured, expectedWarnings }) =>
    withTempDir("omnipolymath-agent-cli-shim-node-", async (stateDir) => {
      await withEnvAsync({ OMNIPOLYMATH_STATE_DIR: stateDir }, prepareGatewayAgentCliShim);
      const config = execConfig(configured);
      expect(config.pathPrepend?.[0]).toBe(path.join(stateDir, "tmp", "agent-cli"));

      const warnings: string[] = [];
      resolvePreparedExecEnvironment({
        execParams: { command: "omnipolymath --version" },
        host: "node",
        defaultPathPrepend: config.pathPrepend ?? [],
        warnings,
      });
      expect(warnings).toEqual(expectedWarnings);
    }),
);

it("renders a Windows PATH launcher for the running CLI", () =>
  withTempDir("omnipolymath-agent-cli-shim-win-", async (root) => {
    vi.spyOn(cliInvocation, "resolveCurrentOmnipolymathCliInvocation").mockReturnValue({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:\\Omnipolymath\\dist\\index.js"],
      cwd: "C:\\Omnipolymath %USERPROFILE%!",
    });
    await withMockedWindowsPlatform(() =>
      withEnvAsync(
        { OMNIPOLYMATH_STATE_DIR: root, OMNIPOLYMATH_PROFILE: "work" },
        prepareGatewayAgentCliShim,
      ),
    );
    expect(await fs.readFile(path.join(root, "tmp", "agent-cli", "omnipolymath.cmd"), "utf8")).toBe(
      '@echo off\r\nsetlocal DisableDelayedExpansion\r\n"C:\\Program Files\\nodejs\\node.exe" C:\\Omnipolymath\\dist\\index.js --profile work %*\r\n',
    );
  }));
