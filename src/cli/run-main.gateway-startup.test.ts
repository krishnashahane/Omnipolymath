import "../test-utils/prepare-compiled-subprocesses.js";
// Register fixture mocks before modules that consume them.
// oxfmt-ignore
import {
  installRunMainTestHooks,
  cliArgs,
  readOnlyCoreOptions,
  tempDirs,
  runCli,
  tryRouteCliMock,
  loadDotEnvMock,
  existsSyncOverride,
  buildProgramMock,
  parkCurrentLaunchAgentForMaintenanceMock,
  readConfigFileSnapshotMock,
  commanderParseAsyncMock,
  addGatewayRunCommandMock,
  ensureCliExecutionBootstrapMock,
  emitCliBannerMock,
  loadConfigMock,
  startProxyMock,
  stopProxyMock,
  withCliExitSpies,
  runGatewayBeforeHook,
  makeProgram,
  validConfig,
} from "./run-main.test-support.js";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";
import { createNewerSqliteSchemaVersionError } from "../infra/sqlite-user-version.js";
import { buildUpdateRehearsalPathEnv } from "../infra/update-rehearsal-paths.js";
import { withEnvAsync } from "../test-utils/env.js";
import { getGatewayRunRuntimeHooks } from "./gateway-cli/runtime-hooks.js";
import { makeProxyHandle } from "./run-main.proxy-exit.test-support.js";

async function withGatewayHome(
  files: (home: string) => Record<string, string>,
  run: (home: string) => Promise<void>,
): Promise<void> {
  const home = tempDirs.make("omnipolymath-run-main-env-");
  for (const [relative, content] of Object.entries(files(home))) {
    const target = path.join(home, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  await withEnvAsync(
    {
      HOME: home,
      OMNIPOLYMATH_HOME: home,
      OMNIPOLYMATH_STATE_DIR: undefined,
      OMNIPOLYMATH_CONFIG_PATH: undefined,
      OMNIPOLYMATH_GATEWAY_TOKEN: undefined,
      OMNIPOLYMATH_GATEWAY_PASSWORD: undefined,
      OMNIPOLYMATH_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS: undefined,
      OMNIPOLYMATH_INCLUDE_ROOTS: undefined,
      NODE_OPTIONS: undefined,
    },
    () => run(home),
  );
}

describe("runCli exit behavior", () => {
  installRunMainTestHooks();

  it.each(["environment selection", "full Commander preaction"])(
    "parks the managed Gateway when a newer schema blocks %s",
    async (phase) => {
      const error = createNewerSqliteSchemaVersionError(
        "Omnipolymath state database",
        "/tmp/omnipolymath-startup/state/omnipolymath.sqlite",
        14,
        13,
      );
      const argv = cliArgs("--log-level", "debug", "gateway", "run");
      if (phase === "environment selection") {
        readConfigFileSnapshotMock.mockRejectedValueOnce(error);
      } else {
        buildProgramMock.mockReturnValueOnce(
          makeProgram("gateway", vi.fn().mockRejectedValueOnce(error)),
        );
        tryRouteCliMock.mockResolvedValueOnce(false);
      }
      await withCliExitSpies(async (errorSpy, exitSpy) => {
        await expect(runCli(argv)).rejects.toMatchObject({ name: "ExitError", code: 78 });

        expect(parkCurrentLaunchAgentForMaintenanceMock).toHaveBeenCalledOnce();
        expect(exitSpy).toHaveBeenCalledWith(78);
        expect(errorSpy.mock.calls.flat().join("\n")).toContain(error.message);
        expect(addGatewayRunCommandMock).not.toHaveBeenCalled();
        if (phase === "environment selection") {
          expect(buildProgramMock).not.toHaveBeenCalled();
        } else {
          expect(buildProgramMock).toHaveBeenCalledOnce();
        }
      });
    },
  );

  it.each([
    { label: "Gateway help", args: ["gateway", "--help"] },
    { label: "another command", args: ["status"] },
  ])("does not park the Gateway for a newer-schema failure during $label", async ({ args }) => {
    const error = createNewerSqliteSchemaVersionError(
      "Omnipolymath state database",
      "/tmp/omnipolymath-startup/state/omnipolymath.sqlite",
      14,
      13,
    );
    buildProgramMock.mockReturnValueOnce(
      makeProgram(args[0], vi.fn().mockRejectedValueOnce(error)),
    );

    await withEnvAsync({ OMNIPOLYMATH_DISABLE_CLI_STARTUP_HELP_FAST_PATH: "1" }, async () => {
      await expect(runCli(cliArgs(...args))).rejects.toBe(error);
    });

    expect(parkCurrentLaunchAgentForMaintenanceMock).not.toHaveBeenCalled();
  });

  it.each(["config drift", "future service config"] as const)(
    "defers %s exit until readiness releases its lease",
    async (kind) => {
      const futureService = kind === "future service config";
      readConfigFileSnapshotMock.mockResolvedValue(
        validConfig(
          { cron: { store: "/tmp/included-a.json" }, gateway: { mode: "local" } },
          { hash: "guarded", path: "/tmp/omnipolymath.json", raw: "{}" },
        ),
      );
      await runCli(cliArgs("gateway"));
      await runGatewayBeforeHook();
      const beforePreparation =
        ensureCliExecutionBootstrapMock.mock.calls[0]?.[0]?.beforeStatePreparation;
      const selected = validConfig(
        futureService
          ? {
              env: { vars: { OMNIPOLYMATH_SERVICE_MARKER: "gateway" } },
              meta: { lastTouchedVersion: "9999.1.1" },
            }
          : { cron: { store: "/tmp/included-b.json" }, gateway: { mode: "local" } },
        { hash: futureService ? "future" : "guarded", path: "/tmp/omnipolymath.json", raw: "{}" },
      );
      if (!futureService) {
        readConfigFileSnapshotMock.mockResolvedValue(selected);
      }
      await withEnvAsync(
        {
          OMNIPOLYMATH_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS: futureService ? "1" : undefined,
          OMNIPOLYMATH_SERVICE_MARKER: undefined,
        },
        () =>
          withCliExitSpies(async (errorSpy, exitSpy) => {
            const preparation = beforePreparation?.(futureService ? selected : undefined);
            await expect(preparation).rejects.toMatchObject({
              name: "ExitError",
              code: futureService ? 78 : 1,
            });
            const message = futureService ? "start the gateway service" : "changed during startup";
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(message));
            if (futureService) {
              expect(process.env.OMNIPOLYMATH_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS).toBeUndefined();
            }
            expect(exitSpy).not.toHaveBeenCalled();
          }),
      );
    },
  );

  it.each([
    ["private", [], undefined, 0],
    ["partial", [], undefined, 1],
    ["outside", [], undefined, 1],
    ["invalid", [], undefined, 1],
    ["service", [], "process", 78],
    ["config service", [], "config", 78],
    ["force", ["--force"], undefined, 1],
    ["reset", ["--dev", "--reset"], undefined, 1],
  ] as const)("guards future config during %s startup", async (scope, flags, service, code) => {
    const root = tempDirs.make("omnipolymath-future-config-");
    let configPath = path.join(root, "omnipolymath.json");
    if (scope === "outside") {
      const outside = tempDirs.make("omnipolymath-future-config-outside-");
      const link = path.join(root, "linked");
      await fs.symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
      configPath = path.join(link, "omnipolymath.json");
    }
    const config = {
      meta: { lastTouchedVersion: "9999.1.1" },
      ...(service === "config" ? { env: { vars: { OMNIPOLYMATH_SERVICE_MARKER: "gateway" } } } : {}),
    };
    readConfigFileSnapshotMock.mockResolvedValue({
      ...validConfig(config, { path: configPath }),
      valid: scope !== "invalid",
    });
    await withEnvAsync(
      {
        ...buildUpdateRehearsalPathEnv(root),
        OMNIPOLYMATH_UPDATE_IN_PROGRESS: "0",
        OMNIPOLYMATH_SERVICE_REPAIR_POLICY: "external",
        OMNIPOLYMATH_UPDATE_PARENT_ALLOWS_GATEWAY_SERVICE_REPAIR: "0",
        OMNIPOLYMATH_UPDATE_PARENT_ALLOWS_GATEWAY_ACTIVATION: scope === "partial" ? undefined : "0",
        OMNIPOLYMATH_COMPATIBILITY_HOST_VERSION: undefined,
        OMNIPOLYMATH_SERVICE_MARKER: service === "process" ? "gateway" : undefined,
        OMNIPOLYMATH_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS: service ? "1" : undefined,
      },
      () =>
        withCliExitSpies(async (errorSpy, exitSpy) => {
          if (code === 0) {
            await runCli(cliArgs("gateway"));
            await runGatewayBeforeHook();
            expect(ensureCliExecutionBootstrapMock).toHaveBeenCalledOnce();
            const beforePreparation =
              ensureCliExecutionBootstrapMock.mock.calls[0]?.[0]?.beforeStatePreparation;
            expect(beforePreparation).toBeTypeOf("function");
            await beforePreparation?.();
            expect(exitSpy).not.toHaveBeenCalled();
          } else {
            await expect(runCli(cliArgs("gateway", ...flags))).rejects.toMatchObject({
              name: "ExitError",
              code,
            });
            const action = service
              ? "start the gateway service"
              : scope === "force"
                ? "force-kill gateway port listeners"
                : scope === "reset"
                  ? "reset the dev gateway state"
                  : "run gateway state preparation";
            const guidance = errorSpy.mock.calls.flat().join("\n");
            expect(guidance).toContain(action);
            expect(guidance).toContain(
              service
                ? "verified pre-update backup"
                : "OMNIPOLYMATH_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS=1",
            );
            if (service) {
              expect(guidance).not.toContain("OMNIPOLYMATH_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS");
            }
            expect(ensureCliExecutionBootstrapMock).not.toHaveBeenCalled();
            expect(readConfigFileSnapshotMock.mock.calls).toEqual([[readOnlyCoreOptions]]);
          }
          expect(config.meta.lastTouchedVersion).toBe("9999.1.1");
          expect(process.env.OMNIPOLYMATH_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS).toBeUndefined();
          if (service === "config") {
            expect(process.env.OMNIPOLYMATH_SERVICE_MARKER).toBeUndefined();
          }
        }),
    );
  });

  it("loads state dotenv before a custom config-root fallback", async () => {
    await withGatewayHome(
      () => ({
        ".omnipolymath/.env": "OMNIPOLYMATH_GATEWAY_TOKEN=state-token\n",
        "profile/.env":
          "OMNIPOLYMATH_GATEWAY_PASSWORD=config-root-password\nOMNIPOLYMATH_GATEWAY_TOKEN=config-root-token\n",
      }),
      async (home) => {
        process.env.OMNIPOLYMATH_CONFIG_PATH = path.join(home, "profile", "omnipolymath.json");
        await runCli(cliArgs("gateway"));
        expect(process.env.OMNIPOLYMATH_GATEWAY_TOKEN).toBe("state-token");
        expect(process.env.OMNIPOLYMATH_GATEWAY_PASSWORD).toBe("config-root-password");
      },
    );
  });

  it("re-guards config selection from a newly selected state dotenv", async () => {
    await withGatewayHome(
      (home) => ({
        "state/.env": `OMNIPOLYMATH_CONFIG_PATH=${path.join(home, "state", "future.json")}\nOMNIPOLYMATH_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS=1\n`,
      }),
      async (home) => {
        const stateDir = path.join(home, "state");
        readConfigFileSnapshotMock.mockImplementation(async () =>
          validConfig(
            process.env.OMNIPOLYMATH_CONFIG_PATH === path.join(stateDir, "future.json")
              ? { meta: { lastTouchedVersion: "9999.1.1" } }
              : { env: { vars: { OMNIPOLYMATH_STATE_DIR: stateDir } }, gateway: { mode: "local" } },
          ),
        );
        await withCliExitSpies(async (errorSpy) => {
          await expect(runCli(cliArgs("gateway"))).rejects.toMatchObject({
            name: "ExitError",
            code: 1,
          });
          expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining("run gateway state preparation"),
          );
          expect(ensureCliExecutionBootstrapMock).not.toHaveBeenCalled();
          expect(readConfigFileSnapshotMock).toHaveBeenCalledTimes(2);
          expect(process.env.OMNIPOLYMATH_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS).toBeUndefined();
        });
      },
    );
  });

  it("does not apply environment variables from invalid config snapshots", async () => {
    await withEnvAsync({ OMNIPOLYMATH_INCLUDE_ROOTS: undefined }, async () => {
      readConfigFileSnapshotMock.mockResolvedValue({
        exists: true,
        issues: [{ message: "invalid", path: "gateway" }],
        legacyIssues: [],
        valid: false,
        sourceConfig: {
          env: { vars: { OMNIPOLYMATH_INCLUDE_ROOTS: "/tmp/omnipolymath-includes" } },
          gateway: { mode: "local" },
        },
      });

      await runCli(cliArgs("gateway"));
      await runGatewayBeforeHook();

      expect(process.env.OMNIPOLYMATH_INCLUDE_ROOTS).toBeUndefined();
      expect(readConfigFileSnapshotMock.mock.calls).toEqual([
        [readOnlyCoreOptions],
        [readOnlyCoreOptions],
      ]);
      expect(ensureCliExecutionBootstrapMock).toHaveBeenCalledWith(
        expect.objectContaining({
          commandPath: ["gateway"],
          beforeStatePreparation: expect.any(Function),
        }),
      );
    });
  });

  it("drops gateway.env selectors when the default state dotenv selects a custom state", async () => {
    await withGatewayHome(
      (home) => ({
        ".omnipolymath/.env": `OMNIPOLYMATH_STATE_DIR=${path.join(home, "selected-state")}\n`,
        ".config/omnipolymath/gateway.env":
          "OMNIPOLYMATH_CONFIG_PATH=/tmp/wrong-omnipolymath.json\nOMNIPOLYMATH_GATEWAY_TOKEN=fallback-token\n",
        "selected-state/.env":
          "OMNIPOLYMATH_GATEWAY_TOKEN=selected-token\nOMNIPOLYMATH_INCLUDE_ROOTS=/tmp/untrusted-include-root\nNODE_OPTIONS=--require /tmp/untrusted.js\n",
      }),
      async (home) => {
        await runCli(cliArgs("gateway"));
        expect(process.env.OMNIPOLYMATH_STATE_DIR).toBe(path.join(home, "selected-state"));
        expect(process.env.OMNIPOLYMATH_CONFIG_PATH).toBeUndefined();
        expect(process.env.OMNIPOLYMATH_GATEWAY_TOKEN).toBe("selected-token");
      },
    );
  });

  it("preserves gateway.env selectors when the compatibility fallback selects the target", async () => {
    await withGatewayHome(
      (home) => ({
        ".config/omnipolymath/gateway.env": `OMNIPOLYMATH_STATE_DIR=${path.join(home, "selected-state")}\nOMNIPOLYMATH_GATEWAY_TOKEN=fallback-token\n`,
        "selected-state/.env": "OMNIPOLYMATH_GATEWAY_TOKEN=selected-token\n",
      }),
      async (home) => {
        await runCli(cliArgs("gateway"));
        expect(process.env.OMNIPOLYMATH_STATE_DIR).toBe(path.join(home, "selected-state"));
        expect(process.env.OMNIPOLYMATH_GATEWAY_TOKEN).toBe("selected-token");
        expect(process.env.OMNIPOLYMATH_INCLUDE_ROOTS).toBeUndefined();
        expect(process.env.NODE_OPTIONS).toBeUndefined();
      },
    );
  });

  it("drops early target credentials when a later guard selects another state", async () => {
    await withGatewayHome(
      () => ({
        ".omnipolymath/.env": "OMNIPOLYMATH_GATEWAY_TOKEN=early-token\n",
        "selected-state/.env": "OMNIPOLYMATH_GATEWAY_TOKEN=selected-token\n",
      }),
      async (home) => {
        const selectedStateDir = path.join(home, "selected-state");
        let selectLateState = false;
        readConfigFileSnapshotMock.mockImplementation(async () =>
          validConfig(
            selectLateState && process.env.OMNIPOLYMATH_STATE_DIR !== selectedStateDir
              ? {
                  env: { vars: { OMNIPOLYMATH_STATE_DIR: selectedStateDir } },
                  gateway: { mode: "local" },
                }
              : { gateway: { mode: "local" } },
          ),
        );
        await runCli(cliArgs("gateway"));
        expect(process.env.OMNIPOLYMATH_GATEWAY_TOKEN).toBe("early-token");
        selectLateState = true;
        await runGatewayBeforeHook();
        expect(process.env.OMNIPOLYMATH_STATE_DIR).toBe(selectedStateDir);
        expect(process.env.OMNIPOLYMATH_GATEWAY_TOKEN).toBe("selected-token");
        expect(ensureCliExecutionBootstrapMock).toHaveBeenCalledOnce();
      },
    );
  });

  it("drops normalized credentials from an early config replaced by a later guard", async () => {
    const { normalizeEnv, normalizeZaiEnv } = await import("../infra/env.js");
    await withEnvAsync({ ZAI_API_KEY: undefined, Z_AI_API_KEY: undefined }, async () => {
      let useReplacement = false;
      readConfigFileSnapshotMock.mockImplementation(async () =>
        validConfig({
          env: { vars: { Z_AI_API_KEY: useReplacement ? "replacement-key" : "superseded-key" } },
          gateway: { mode: "local" },
        }),
      );
      await vi.mocked(normalizeEnv).withImplementation(
        () => normalizeZaiEnv(),
        async () => {
          await runCli(cliArgs("gateway"));
          expect(process.env.ZAI_API_KEY).toBe("superseded-key");

          useReplacement = true;
          await runGatewayBeforeHook();

          expect(process.env.Z_AI_API_KEY).toBe("replacement-key");
          expect(process.env.ZAI_API_KEY).toBe("replacement-key");
        },
      );
    });
  });

  it("does not let gateway.env authorize automatic mutations of a selected future config", async () => {
    await withGatewayHome(
      () => ({
        ".config/omnipolymath/gateway.env": "OMNIPOLYMATH_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS=1\n",
      }),
      async (home) => {
        const futureConfigPath = path.join(home, "future.json");
        readConfigFileSnapshotMock.mockImplementation(async () =>
          validConfig(
            process.env.OMNIPOLYMATH_CONFIG_PATH === futureConfigPath
              ? { meta: { lastTouchedVersion: "9999.1.1" } }
              : {
                  env: { vars: { OMNIPOLYMATH_CONFIG_PATH: futureConfigPath } },
                  gateway: { mode: "local" },
                },
          ),
        );
        await withCliExitSpies(async (errorSpy) => {
          await expect(runCli(cliArgs("gateway"))).rejects.toMatchObject({
            name: "ExitError",
            code: 1,
          });
          expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining("run gateway state preparation"),
          );
          expect(ensureCliExecutionBootstrapMock).not.toHaveBeenCalled();
          expect(process.env.OMNIPOLYMATH_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS).toBeUndefined();
        });
      },
    );
  });

  it("retains selected config paths and invocation reset targets", async () => {
    await withEnvAsync(
      {
        OMNIPOLYMATH_CONFIG_PATH: "/tmp/omnipolymath-invocation/omnipolymath.json",
        OMNIPOLYMATH_GATEWAY_TOKEN: undefined,
        OMNIPOLYMATH_HOME: "/tmp/omnipolymath-invocation-home",
        OMNIPOLYMATH_INCLUDE_ROOTS: undefined,
        OMNIPOLYMATH_PROFILE: undefined,
        OMNIPOLYMATH_STATE_DIR: "/tmp/omnipolymath-invocation-state",
        OMNIPOLYMATH_TEST_FAST: "1",
        OMNIPOLYMATH_WORKSPACE_DIR: "/tmp/omnipolymath-invocation-workspace",
      },
      async () => {
        readConfigFileSnapshotMock.mockResolvedValue(
          validConfig({
            env: {
              vars: {
                OMNIPOLYMATH_CONFIG_PATH: "/tmp/omnipolymath-reset/omnipolymath.json",
                OMNIPOLYMATH_GATEWAY_TOKEN: "old-token",
                OMNIPOLYMATH_HOME: "/tmp/omnipolymath-reset-home",
                OMNIPOLYMATH_INCLUDE_ROOTS: "/tmp/omnipolymath-reset-includes",
                OMNIPOLYMATH_PROFILE: "config-dev",
                OMNIPOLYMATH_STATE_DIR: "/tmp/omnipolymath-reset",
                OMNIPOLYMATH_TEST_FAST: "0",
                OMNIPOLYMATH_WORKSPACE_DIR: "/tmp/omnipolymath-reset-workspace",
              },
            },
            gateway: { mode: "local" },
          }),
        );
        await runCli(cliArgs("gateway", "--dev", "--reset"));

        await runGatewayBeforeHook({ reset: true });

        expect(process.env.OMNIPOLYMATH_CONFIG_PATH).toBe("/tmp/omnipolymath-invocation/omnipolymath.json");
        expect(process.env.OMNIPOLYMATH_HOME).toBe("/tmp/omnipolymath-invocation-home");
        expect(process.env.OMNIPOLYMATH_PROFILE).toBeUndefined();
        expect(process.env.OMNIPOLYMATH_STATE_DIR).toBe("/tmp/omnipolymath-invocation-state");
        expect(process.env.OMNIPOLYMATH_TEST_FAST).toBe("1");
        expect(process.env.OMNIPOLYMATH_WORKSPACE_DIR).toBe("/tmp/omnipolymath-invocation-workspace");
        expect(process.env.OMNIPOLYMATH_GATEWAY_TOKEN).toBeUndefined();
        expect(process.env.OMNIPOLYMATH_INCLUDE_ROOTS).toBeUndefined();
        expect(ensureCliExecutionBootstrapMock).not.toHaveBeenCalled();
      },
    );
  });

  it("honors banner suppression on the gateway foreground fast path", async () => {
    process.env.OMNIPOLYMATH_HIDE_BANNER = "1";

    await runCli(cliArgs("gateway"));

    expect(tryRouteCliMock).not.toHaveBeenCalled();
    expect(emitCliBannerMock).not.toHaveBeenCalled();
    expect(commanderParseAsyncMock).toHaveBeenCalledWith(cliArgs("gateway"));
  });

  it("keeps explicit database preflight isolated from default state selection", async () => {
    tryRouteCliMock.mockResolvedValueOnce(true);

    await runCli(cliArgs("database", "preflight", "/tmp/omnipolymath-candidate.sqlite", "--json"));

    expect(loadDotEnvMock).not.toHaveBeenCalled();
    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(startProxyMock).not.toHaveBeenCalled();
  });

  it("replaces the early managed proxy with the final accepted gateway config", async () => {
    existsSyncOverride.value = (target) => target === path.join(process.cwd(), ".env");
    const earlyHandle = makeProxyHandle();
    const finalHandle = makeProxyHandle();
    const earlyProxy = { proxyUrl: "http://127.0.0.1:19876" };
    const finalProxy = { proxyUrl: "http://127.0.0.1:29876" };
    loadConfigMock.mockReturnValueOnce({ proxy: earlyProxy });
    startProxyMock.mockResolvedValueOnce(earlyHandle).mockResolvedValueOnce(finalHandle);
    commanderParseAsyncMock.mockImplementationOnce(async () => {
      await runGatewayBeforeHook();
      await getGatewayRunRuntimeHooks().refreshManagedProxy?.(finalProxy);
    });

    await runCli(cliArgs("gateway", "run"));

    expect(loadDotEnvMock).toHaveBeenCalledWith({ loadGlobalEnv: false });
    expect(loadConfigMock).toHaveBeenCalledWith(readOnlyCoreOptions);
    expect(startProxyMock).toHaveBeenNthCalledWith(1, earlyProxy);
    expect(startProxyMock).toHaveBeenNthCalledWith(2, finalProxy);
    expect(stopProxyMock).toHaveBeenNthCalledWith(1, earlyHandle);
    expect(stopProxyMock).toHaveBeenNthCalledWith(2, finalHandle);
    const earlyStopOrder = stopProxyMock.mock.invocationCallOrder[0] ?? 0;
    const finalEnvironmentReadOrder = readConfigFileSnapshotMock.mock.invocationCallOrder[1] ?? 0;
    const finalStartOrder = startProxyMock.mock.invocationCallOrder[1] ?? 0;
    expect(finalEnvironmentReadOrder).toBeGreaterThan(earlyStopOrder);
    expect(finalStartOrder).toBeGreaterThan(earlyStopOrder);
  });

  it("removes early proxy signal handlers when the final config disables the proxy", async () => {
    const earlyHandle = makeProxyHandle();
    const earlyProxy = { proxyUrl: "http://127.0.0.1:19876" };
    const finalProxy = undefined;
    loadConfigMock.mockReturnValueOnce({ proxy: earlyProxy });
    startProxyMock.mockResolvedValueOnce(earlyHandle).mockResolvedValueOnce(null);
    const processOnceSpy = vi.spyOn(process, "once");
    const processOffSpy = vi.spyOn(process, "off");
    commanderParseAsyncMock.mockImplementationOnce(async () => {
      const sigtermHandler = processOnceSpy.mock.calls.find(([event]) => event === "SIGTERM")?.[1];
      const sigintHandler = processOnceSpy.mock.calls.find(([event]) => event === "SIGINT")?.[1];
      const exitHandler = processOnceSpy.mock.calls.find(([event]) => event === "exit")?.[1];

      await getGatewayRunRuntimeHooks().refreshManagedProxy?.(finalProxy);

      expect(processOffSpy).toHaveBeenCalledWith("SIGTERM", sigtermHandler);
      expect(processOffSpy).toHaveBeenCalledWith("SIGINT", sigintHandler);
      expect(processOffSpy).toHaveBeenCalledWith("exit", exitHandler);
    });

    try {
      await runCli(cliArgs("gateway", "run"));
    } finally {
      processOffSpy.mockRestore();
      processOnceSpy.mockRestore();
    }

    expect(startProxyMock).toHaveBeenNthCalledWith(1, earlyProxy);
    expect(startProxyMock).toHaveBeenNthCalledWith(2, finalProxy);
    expect(stopProxyMock).toHaveBeenCalledOnce();
    expect(stopProxyMock).toHaveBeenCalledWith(earlyHandle);
  });
});
