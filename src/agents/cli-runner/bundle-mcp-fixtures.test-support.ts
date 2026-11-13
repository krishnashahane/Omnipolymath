import fs from "node:fs/promises";
import { onTestFinished } from "vitest";
import type { McpServerConfig } from "../../config/types.mcp.js";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import { prepareCliBundleMcpConfig } from "./bundle-mcp.js";
import {
  cliBundleMcpHarness,
  requireMcpConfigPath,
  writeCliMcpPolicyProbeServer,
} from "./bundle-mcp.test-support.js";

export type CliMcpParams = Parameters<typeof prepareCliBundleMcpConfig>[0];
type Prepared = Awaited<ReturnType<typeof prepareCliBundleMcpConfig>>;
type Settings = {
  mcpServers?: Record<string, McpServerConfig>;
  mcp?: { allowed?: string[] };
  tools?: { exclude?: string[] };
  security?: { auth?: { selectedType?: string }; folderTrust?: { enabled?: boolean } };
};

export async function trackMcpPreparation(preparation: Promise<Prepared>) {
  const prepared = await preparation;
  onTestFinished(() => prepared.cleanup?.());
  return prepared;
}

export async function prepareMcp(
  input: Partial<CliMcpParams> | (() => Promise<Partial<CliMcpParams>>),
  afterCleanup?: () => Promise<void>,
) {
  let prepared: Prepared | undefined = undefined;
  onTestFinished(async () => {
    await prepared?.cleanup?.();
    await afterCleanup?.();
  });
  const params = typeof input === "function" ? await input() : input;
  const gemini = params.mode === "gemini-system-settings";
  const backend = gemini
    ? { command: "gemini", args: ["--prompt", "{prompt}"] }
    : params.mode === "codex-config-overrides"
      ? { command: "codex", args: ["exec"] }
      : { command: "node", args: ["./fake-claude.mjs"] };
  prepared = await prepareCliBundleMcpConfig({
    enabled: true,
    backend,
    workspaceDir: gemini
      ? "/tmp/omnipolymath-bundle-mcp-gemini"
      : cliBundleMcpHarness.bundleProbeWorkspaceDir,
    ...params,
  });
  return prepared;
}

export async function readMcpConfig(prepared: Prepared, gemini = false): Promise<Settings> {
  const filePath = gemini
    ? (prepared.env?.GEMINI_CLI_SYSTEM_SETTINGS_PATH as string)
    : requireMcpConfigPath(prepared.backend.args);
  return JSON.parse(await fs.readFile(filePath, "utf-8")) as Settings;
}

export async function policyConfig(
  options: {
    tools?: OmnipolymathConfig["tools"];
    agents?: OmnipolymathConfig["agents"];
    server?: McpServerConfig;
  } = {},
): Promise<OmnipolymathConfig> {
  const { server, ...config } = options;
  return userMcpConfig(
    {
      docs: {
        command: process.execPath,
        args: server?.args ?? [await writeCliMcpPolicyProbeServer()],
        ...server,
      },
    },
    config,
  );
}

export const userMcpConfig = (
  servers: Record<string, McpServerConfig>,
  extra: OmnipolymathConfig = {},
): OmnipolymathConfig => ({ plugins: { enabled: false }, ...extra, mcp: { servers } });

export function loopbackConfig(options: McpServerConfig = {}) {
  return {
    mcpServers: {
      omnipolymath: {
        type: "http",
        url: "http://127.0.0.1:23119/mcp",
        ...options,
      },
    },
  };
}
