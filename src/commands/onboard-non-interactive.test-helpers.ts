import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "vitest";
import { listAgentEntries, resolveAmbientOwnerAgentId } from "../agents/agent-scope-config.js";
import { createConfigFileSnapshot } from "../config/io.snapshot-shared.js";
import type { ConfigFileSnapshot, OmnipolymathConfig } from "../config/types.omnipolymath.js";
import type { RuntimeEnv } from "../runtime.js";
import { captureEnv, deleteTestEnvValue, setTestEnvValue } from "../test-utils/env.js";

type NonInteractiveRuntime = Pick<RuntimeEnv, "log" | "error" | "exit">;

export type WaitForGatewayReachableMock =
  | ((params: {
      url: string;
      token?: string;
      password?: string;
      deadlineMs?: number;
      probeTimeoutMs?: number;
    }) => Promise<{ ok: boolean; detail?: string }>)
  | undefined;

type RunNonInteractiveSetup = typeof import("./onboard-non-interactive.js").runNonInteractiveSetup;

export type OnboardGatewayHealthCall = {
  password?: string;
  token?: string;
};

export function createThrowingRuntime(): NonInteractiveRuntime {
  return {
    log: () => {},
    error: (...args: unknown[]) => {
      throw new Error(args.map(String).join(" "));
    },
    exit: (code: number) => {
      throw new Error(`exit:${code}`);
    },
  };
}

export function createOnboardJsonCaptureRuntime() {
  let capturedJson = "";
  const format = (value: unknown) =>
    typeof value === "string"
      ? value
      : value instanceof Error
        ? value.message
        : (JSON.stringify(value) ?? "");
  const runtimeWithCapture: RuntimeEnv = {
    log: (value: unknown) => {
      capturedJson = format(value);
    },
    error: (value: unknown) => {
      throw new Error(format(value));
    },
    exit: () => {
      throw new Error("exit should not be reached after runtime.error");
    },
  };

  return {
    runtimeWithCapture,
    readCapturedJson: () => capturedJson,
  };
}

export function readOnboardFirstMockCall(mock: unknown, label: string): unknown[] {
  const calls = (mock as { mock: { calls: unknown[][] } }).mock.calls;
  const call = calls[0];
  if (!call) {
    throw new Error(`Expected ${label} to be called`);
  }
  return call;
}

export function createOnboardTestConfigStore() {
  const configStore = new Map<string, OmnipolymathConfig>();

  function resolveConfigPath() {
    const override = process.env.OMNIPOLYMATH_CONFIG_PATH?.trim();
    if (override) {
      return override;
    }
    const stateDir = process.env.OMNIPOLYMATH_STATE_DIR?.trim();
    if (!stateDir) {
      throw new Error("OMNIPOLYMATH_STATE_DIR must be set before config IO in this test");
    }
    return path.join(stateDir, "omnipolymath.json");
  }

  function readConfig(): OmnipolymathConfig {
    return configStore.get(resolveConfigPath()) ?? {};
  }

  function readSnapshot(): ConfigFileSnapshot {
    const configPath = resolveConfigPath();
    const config = configStore.get(configPath) ?? {};
    const exists = configStore.has(configPath);
    return createConfigFileSnapshot({
      path: configPath,
      exists,
      raw: exists ? `${JSON.stringify(config, null, 2)}\n` : null,
      parsed: config,
      sourceConfigBeforeMigrations: config,
      sourceConfig: config,
      valid: true,
      runtimeConfig: config,
      ...(exists ? { hash: "test-config-hash" } : {}),
      issues: [],
      warnings: [],
      legacyIssues: [],
    });
  }

  return { configStore, resolveConfigPath, readConfig, readSnapshot };
}

export function createOnboardStateDirHarness(getTempHome: () => string | undefined) {
  async function withStateDir(
    prefix: string,
    run: (stateDir: string) => Promise<void>,
  ): Promise<void> {
    const tempHome = getTempHome();
    if (!tempHome) {
      throw new Error("temp home not initialized");
    }
    const stateDir = await fs.realpath(await fs.mkdtemp(path.join(tempHome, prefix)));
    setTestEnvValue("OMNIPOLYMATH_STATE_DIR", stateDir);
    deleteTestEnvValue("OMNIPOLYMATH_CONFIG_PATH");
    try {
      await run(stateDir);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  }

  return { withStateDir };
}

export function prepareOnboardGatewayTestEnv() {
  const skipKeys = [
    "OMNIPOLYMATH_SKIP_CHANNELS",
    "OMNIPOLYMATH_SKIP_GMAIL_WATCHER",
    "OMNIPOLYMATH_SKIP_CRON",
    "OMNIPOLYMATH_SKIP_CANVAS_HOST",
    "OMNIPOLYMATH_SKIP_BROWSER_CONTROL_SERVER",
  ];
  const snapshot = captureEnv([
    "HOME",
    "OMNIPOLYMATH_STATE_DIR",
    "OMNIPOLYMATH_CONFIG_PATH",
    ...skipKeys,
    "OMNIPOLYMATH_GATEWAY_TOKEN",
    "OMNIPOLYMATH_GATEWAY_PASSWORD",
  ]);
  for (const key of skipKeys) {
    setTestEnvValue(key, "1");
  }
  deleteTestEnvValue("OMNIPOLYMATH_GATEWAY_TOKEN");
  deleteTestEnvValue("OMNIPOLYMATH_GATEWAY_PASSWORD");
  return snapshot;
}

export function createOnboardLocalDaemonOptions(stateDir: string) {
  return {
    nonInteractive: true,
    mode: "local" as const,
    workspace: path.join(stateDir, "omnipolymath"),
    authChoice: "skip" as const,
    skipSkills: true,
    skipHealth: false,
    installDaemon: true,
    gatewayBind: "loopback" as const,
  };
}

export async function expectOnboardLocalJsonSetupFailure(params: {
  runSetup: RunNonInteractiveSetup;
  stateDir: string;
  runtime: RuntimeEnv;
}) {
  await expect(
    params.runSetup(
      { ...createOnboardLocalDaemonOptions(params.stateDir), json: true },
      params.runtime,
    ),
  ).rejects.toThrow("exit should not be reached after runtime.error");
}

export async function mockOnboardingAgent(params: {
  config: OmnipolymathConfig;
  baseConfig?: OmnipolymathConfig;
  workspace: string;
}) {
  const bootstrapPending = listAgentEntries(params.config).length === 0;
  return {
    configBase: params.baseConfig ?? params.config,
    config: bootstrapPending
      ? {
          ...params.config,
          agents: {
            ...params.config.agents,
            entries: { main: { name: "main", workspace: params.workspace } },
          },
        }
      : params.config,
    agentId: bootstrapPending ? "main" : resolveAmbientOwnerAgentId(params.config),
    bootstrapPending,
  };
}
