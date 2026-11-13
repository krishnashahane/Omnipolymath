import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { createTempDirTracker } from "../../test/helpers/temp-dir.js";
import * as runtimeConfig from "../config/config.js";
import { closeOmnipolymathStateDatabaseForTest } from "../state/omnipolymath-state-db.js";
import { withEnvAsync } from "../test-utils/env.js";
import { runCommand } from "./invoke-run-command.js";
import { handleSystemRunInvoke } from "./invoke-system-run.js";

describe("node command service identity", () => {
  const tempDirs = createTempDirTracker();
  let stateDir = "";

  beforeAll(() => {
    closeOmnipolymathStateDatabaseForTest();
    stateDir = tempDirs.make("node-child-state-");
  });

  afterAll(() => {
    closeOmnipolymathStateDatabaseForTest();
    tempDirs.cleanup();
  });

  it.each([undefined, { chatId: "chat-1" }])(
    "runs child commands without inherited service identity with context %j",
    async (executionContext) => {
      const serviceEnv = {
        OMNIPOLYMATH_SERVICE_MARKER: "omnipolymath",
        OMNIPOLYMATH_SERVICE_KIND: "node",
        OMNIPOLYMATH_LAUNCHD_LABEL: "ai.omnipolymath.node",
        OMNIPOLYMATH_SYSTEMD_UNIT: "omnipolymath-node",
        OMNIPOLYMATH_WINDOWS_TASK_NAME: "Omnipolymath Node",
        OMNIPOLYMATH_WINDOWS_TASK_HIDDEN_LAUNCHER: "1",
        OMNIPOLYMATH_TASK_SCRIPT_NAME: "node.cmd",
        OMNIPOLYMATH_LOG_PREFIX: "node",
        OMNIPOLYMATH_GATEWAY_SERVICE_PID: "12345",
      };
      await withEnvAsync(
        {
          ...serviceEnv,
          OMNIPOLYMATH_HOME: stateDir,
          OMNIPOLYMATH_STATE_DIR: stateDir,
          OMNIPOLYMATH_PROFILE: "node-proof",
        },
        async () => {
          const config = vi.spyOn(runtimeConfig, "getRuntimeConfig").mockReturnValue({
            tools: { exec: { security: "full", ask: "off" } },
          });
          onTestFinished(() => config.mockRestore());
          const keys = [...Object.keys(serviceEnv), "OMNIPOLYMATH_STATE_DIR", "OMNIPOLYMATH_PROFILE"];
          const command = [
            process.execPath,
            "-e",
            `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map(key => [key, process.env[key]]))))`,
          ];
          for (const env of [undefined, { OMNIPOLYMATH_SYSTEMD_UNIT: "custom-gateway.service" }]) {
            const sendInvokeResult = vi.fn<
              Parameters<typeof handleSystemRunInvoke>[0]["sendInvokeResult"]
            >(async () => {});
            await handleSystemRunInvoke({
              params: { command, env, executionContext },
              skillBins: { current: async () => [] },
              runCommand,
              sendInvokeResult,
              preferMacAppExecHost: false,
            });
            const [response] = sendInvokeResult.mock.calls[0] ?? [];
            expect(response?.ok).toBe(true);
            const result = JSON.parse(response?.payloadJSON ?? "{}");
            expect(result).toMatchObject({ success: true, exitCode: 0 });
            expect(JSON.parse(result.stdout)).toEqual({
              OMNIPOLYMATH_STATE_DIR: stateDir,
              OMNIPOLYMATH_PROFILE: "node-proof",
              ...env,
            });
          }
          expect(process.env).toMatchObject(serviceEnv);
        },
      );
    },
  );
});
