import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { useAutoCleanupTempDirTracker } from "omnipolymath/plugin-sdk/test-env";
import { afterEach, expect, it, vi } from "vitest";
import { resolveAcpxPluginConfig, resolveAcpxPluginRoot } from "./config.js";

const TSX_IMPORT = import.meta.resolve("tsx");
const runtimeArgs = process.versions.bun ? ["--no-install"] : [];
const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const workspaceDir = path.resolve("/tmp/omnipolymath-acpx");
const resolve = (
  rawConfig?: unknown,
  options: Omit<Parameters<typeof resolveAcpxPluginConfig>[0], "rawConfig"> = {},
) => resolveAcpxPluginConfig({ workspaceDir, rawConfig, ...options });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("resolves state independently of the session working directory", () => {
  const stateDir = path.resolve("/tmp/omnipolymath-state");
  vi.stubEnv("OMNIPOLYMATH_STATE_DIR", stateDir);
  const resolved = resolve();
  expect(resolved).toMatchObject({
    cwd: workspaceDir,
    stateDir: path.join(stateDir, "acpx"),
    permissionMode: "approve-reads",
    nonInteractivePermissions: "fail",
    timeoutSeconds: 120,
    probeAgent: undefined,
  });
  expect(resolved.agents).toStrictEqual({});
  expect(resolve({ stateDir: workspaceDir }, { stateDir }).stateDir).toBe(workspaceDir);
  expect(resolve({}, { stateDir: workspaceDir }).stateDir).toBe(path.join(workspaceDir, "acpx"));
});

it.each([
  ["win32", String.raw`node "say \"hello\""`, ["node", 'say "hello"']],
  ["linux", String.raw`node ./some\ file.js ""`, ["node", "./some file.js", ""]],
] as const)("preserves %s command syntax: %s", (platform, command, expected) => {
  vi.spyOn(process, "platform", "get").mockReturnValue(platform);
  const config = resolve({ agents: { fixture: { command, args: ["suffix"] } } });
  expect(config.agents.fixture).toEqual([...expected, "suffix"]);
});

it.each([
  [{ agents: { custom: { command: "node 'unfinished argument" } } }, "unterminated quote"],
  [{ probeAgent: "" }, /probeAgent must be a non-empty string/],
] as const)("rejects invalid config %j", (config, error) => {
  expect(() => resolve(config)).toThrow(error);
});

it("passes agent process env lists through and leaves them unset by default", () => {
  const resolved = resolve();
  expect(resolved.agentProcessEnvAllow).toBeUndefined();
  expect(resolved.agentProcessEnvBlock).toBeUndefined();
  expect(
    resolve({ agentProcessEnvAllow: [], agentProcessEnvBlock: ["OMNIPOLYMATH_GATEWAY_TOKEN"] }),
  ).toMatchObject({
    agentProcessEnvAllow: [],
    agentProcessEnvBlock: ["OMNIPOLYMATH_GATEWAY_TOKEN"],
  });
});

it.each([
  ["agentProcessEnvBlock", "OMNIPOLYMATH_GATEWAY_TOKEN"],
  ["agentProcessEnvBlock", [""]],
  ["agentProcessEnvBlock", ["NAME=value"]],
  ["agentProcessEnvAllow", [" PATH"]],
  ["agentProcessEnvAllow", ["NUL\u0000NAME"]],
  ["agentProcessEnvAllow", [42]],
] as const)("rejects invalid %s %j", (key, value) => {
  expect(() => resolve({ [key]: value })).toThrow(
    `${key} must be an array of environment variable names`,
  );
});

it("injects the built-in plugin-tools MCP server only when explicitly enabled", () => {
  const distEntry = path.resolve("dist/mcp/plugin-tools-serve.js");
  expect(resolve({ pluginToolsMcpBridge: true }).mcpServers["omnipolymath-plugin-tools"]).toEqual({
    command: process.execPath,
    args: fs.existsSync(distEntry)
      ? [...runtimeArgs, distEntry]
      : [
          ...runtimeArgs,
          ...(process.versions.bun ? [] : ["--import", TSX_IMPORT]),
          path.resolve("src/mcp/plugin-tools-serve.ts"),
        ],
  });
});

it("launches managed bridges from the host package when acpx is an external package", () => {
  const tmp = fs.realpathSync(tempDirs.make("omnipolymath-acpx-external-"));
  const hostRoot = path.join(tmp, "lib", "node_modules", "omnipolymath");
  fs.mkdirSync(path.join(hostRoot, "dist", "mcp"), { recursive: true });
  fs.writeFileSync(path.join(hostRoot, "package.json"), JSON.stringify({ name: "omnipolymath" }));
  fs.writeFileSync(path.join(hostRoot, "omnipolymath.mjs"), "");
  fs.writeFileSync(path.join(hostRoot, "dist", "mcp", "plugin-tools-serve.js"), "");
  fs.writeFileSync(path.join(hostRoot, "dist", "mcp", "omnipolymath-tools-serve.js"), "");
  fs.mkdirSync(path.join(tmp, "bin"));
  fs.symlinkSync(path.join(hostRoot, "omnipolymath.mjs"), path.join(tmp, "bin", "omnipolymath"));
  const pluginRoot = path.join(tmp, "captures", "package-0", "node_modules", "@omnipolymath", "acpx");
  fs.mkdirSync(path.join(pluginRoot, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(pluginRoot, "package.json"),
    JSON.stringify({ name: "@omnipolymath/acpx" }),
  );
  fs.writeFileSync(path.join(pluginRoot, "omnipolymath.plugin.json"), "{}");
  const originalArgv = process.argv;
  process.argv = [process.execPath, path.join(tmp, "bin", "omnipolymath"), "gateway"];
  try {
    const resolved = resolve(
      { pluginToolsMcpBridge: true, omnipolymathToolsMcpBridge: true },
      {
        moduleUrl: pathToFileURL(path.join(pluginRoot, "dist", "config.js")).href,
      },
    );

    expect(resolved.mcpServers).toEqual({
      "omnipolymath-plugin-tools": {
        command: process.execPath,
        args: [...runtimeArgs, path.join(hostRoot, "dist", "mcp", "plugin-tools-serve.js")],
      },
      "omnipolymath-tools": {
        command: process.execPath,
        args: [...runtimeArgs, path.join(hostRoot, "dist", "mcp", "omnipolymath-tools-serve.js")],
      },
    });
  } finally {
    process.argv = originalArgv;
  }
});

it("resolves the plugin root from shared dist chunk paths", () => {
  const moduleUrl = new URL("../../../dist/extensions/acpx/service-shared.js", import.meta.url)
    .href;

  expect(resolveAcpxPluginRoot(moduleUrl)).toBe(path.resolve("extensions/acpx"));
});
