import { afterEach, describe, expect, it } from "vitest";
import { createQaGatewaySetupHarness } from "./gateway-child-setup.test-support.js";

const setup = createQaGatewaySetupHarness();
afterEach(() => setup.cleanup());

describe("QA child service identity", () => {
  it("keeps cron suppression under the child's runtime controls", async () => {
    expect(
      (await setup.prepare({}, { OMNIPOLYMATH_SKIP_CRON: "1" })).env.OMNIPOLYMATH_SKIP_CRON,
    ).toBeUndefined();
    expect(
      (
        await setup.prepare(
          {
            runtimeEnvPatch: { OMNIPOLYMATH_SKIP_CRON: "1" },
          },
          { OMNIPOLYMATH_SKIP_CRON: "1" },
        )
      ).env.OMNIPOLYMATH_SKIP_CRON,
    ).toBe("1");
  });

  it.each(["parent", "runtime patch"])(
    "keeps %s supervision out of QA-owned children",
    async (source) => {
      const supervisorEnv = {
        OMNIPOLYMATH_SUPERVISOR_MODE: "external",
        OMNIPOLYMATH_LAUNCHD_LABEL: "ai.omnipolymath.gateway",
        LAUNCH_JOB_LABEL: "ai.omnipolymath.gateway",
        LAUNCH_JOB_NAME: "ai.omnipolymath.gateway",
        XPC_SERVICE_NAME: "ai.omnipolymath.gateway",
        OMNIPOLYMATH_SYSTEMD_UNIT: "omnipolymath-gateway.service",
        INVOCATION_ID: "synthetic-parent-invocation",
        SYSTEMD_EXEC_PID: "1234",
        JOURNAL_STREAM: "8:1234",
        OMNIPOLYMATH_WINDOWS_TASK_NAME: "Omnipolymath Gateway",
        OMNIPOLYMATH_SERVICE_MARKER: "omnipolymath",
        OMNIPOLYMATH_SERVICE_KIND: "gateway",
      };
      const child = await setup.prepare(
        {
          runtimeEnvPatch:
            source === "runtime patch"
              ? { ...supervisorEnv, OMNIPOLYMATH_PROFILE: "operator" }
              : undefined,
        },
        source === "parent" ? { ...supervisorEnv, OMNIPOLYMATH_PROFILE: "operator" } : {},
      );
      const { env } = child;

      for (const key of Object.keys(supervisorEnv)) {
        expect(env[key], key).toBeUndefined();
      }
      expect(env.OMNIPOLYMATH_NO_RESPAWN).toBe("1");
      expect(env.OMNIPOLYMATH_GATEWAY_HOST_LIFELINE).toBe("stdin");
      expect(env.OMNIPOLYMATH_PROFILE).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/u);
      expect(env.OMNIPOLYMATH_PROFILE).not.toBe("operator");
      expect(env.OMNIPOLYMATH_PROFILE).not.toBe("default");
      expect(env.OMNIPOLYMATH_PROFILE).toBe((await child.prepareAttempt()).env.OMNIPOLYMATH_PROFILE);
      expect(env.OMNIPOLYMATH_PROFILE).not.toBe((await setup.prepare()).env.OMNIPOLYMATH_PROFILE);
      expect(env.OMNIPOLYMATH_STATE_DIR).toBe(child.stateDir);
      expect(env.OMNIPOLYMATH_CONFIG_PATH).toBe(child.configPath);
    },
  );
});
