import { afterEach, expect, it, vi } from "vitest";
import "./test-helpers/fast-bash-tools.js";
import "./test-helpers/fast-coding-tools.js";
import "./test-helpers/fast-omnipolymath-tools.js";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../config/config.js";
import type { OmnipolymathConfig } from "../config/types.js";
import { updateExecApprovals } from "../infra/exec-approvals-store.js";
import { closeOmnipolymathStateDatabaseAsync } from "../state/omnipolymath-state-db.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import { withEnvAsync } from "../test-utils/env.js";
import { createAdmittedHostCapabilityTestFixture } from "./harness/host-capability.test-support.js";
import * as omnipolymathPluginTools from "./omnipolymath-plugin-tools.js";
import { createOmnipolymathTools } from "./omnipolymath-tools.js";
import { resolveOmnipolymathPluginToolInputs } from "./omnipolymath-tools.plugin-context.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    await closeOmnipolymathStateDatabaseAsync();
    cleanup();
  }),
);

async function withPreparedBrowserLoopback(
  params: { runId: string; config: OmnipolymathConfig; abortSignal?: AbortSignal },
  run: (prepared: {
    assertCurrent: () => void;
    publish: (security: "full" | "deny") => Promise<void>;
  }) => Promise<void> | void,
) {
  const stateDir = tempDirs.make("browser-loopback-policy-");
  const context = captureOmnipolymathStateWorkerContext({
    env: { ...process.env, OMNIPOLYMATH_STATE_DIR: stateDir },
  });
  const publish = async (security: "full" | "deny") => {
    await updateExecApprovals(
      {
        update: {
          kind: "replace",
          file: { version: 1, defaults: { security, ask: "off" } },
        },
      },
      context,
    );
  };
  await publish("full");
  await withEnvAsync({ OMNIPOLYMATH_STATE_DIR: stateDir }, async () => {
    const { hostCapabilities, closeHost, closeAdmission } =
      await createAdmittedHostCapabilityTestFixture({
        runId: params.runId,
        config: params.config,
      });
    const plugins = vi
      .spyOn(omnipolymathPluginTools, "resolveOmnipolymathPluginToolsForOptionsAsync")
      .mockResolvedValue([]);
    try {
      vi.mocked(createOmnipolymathTools).mockClear();
      await hostCapabilities.createToolSurfaceAsync!(
        {
          config: params.config,
          abortSignal: params.abortSignal,
        },
        { nativeLocalExecution: true },
      );
      const { context: toolContext } = resolveOmnipolymathPluginToolInputs({
        options: vi.mocked(createOmnipolymathTools).mock.calls.at(-1)?.[0],
      });
      expect(toolContext.browser.allowLocalLoopback).toBe(true);
      const assertCurrent = toolContext.browser.assertLocalLoopbackCurrent;
      expect(assertCurrent).toBeTypeOf("function");
      if (!assertCurrent) {
        throw new Error("Missing prepared browser loopback assertion");
      }
      await run({ assertCurrent, publish });
    } finally {
      plugins.mockRestore();
      closeHost();
      closeAdmission();
    }
  });
}

it("revokes an automatic preview when the execution-policy owner restricts host approvals", async () => {
  await withPreparedBrowserLoopback(
    { runId: "browser-loopback-approval-revocation", config: {} },
    async ({ assertCurrent, publish }) => {
      expect(assertCurrent).not.toThrow();
      await publish("deny");
      expect(assertCurrent).toThrow("current unrestricted local execution");
      await publish("full");
      expect(assertCurrent).not.toThrow();
    },
  );
});

it("revokes the native turn grant when its inner abort signal closes", async () => {
  const controller = new AbortController();
  await withPreparedBrowserLoopback(
    {
      runId: "browser-loopback-turn-abort",
      config: {},
      abortSignal: controller.signal,
    },
    ({ assertCurrent }) => {
      expect(assertCurrent).not.toThrow();
      controller.abort(new Error("native turn replaced"));
      expect(assertCurrent).toThrow("native turn replaced");
    },
  );
});

it("retires the grant when the runtime config owner publishes a policy change", async () => {
  const config = {
    tools: { exec: { host: "gateway" as const, security: "full" as const, ask: "off" as const } },
  };
  setRuntimeConfigSnapshot(config);
  try {
    await withPreparedBrowserLoopback(
      { runId: "browser-loopback-config-publication", config },
      ({ assertCurrent }) => {
        expect(assertCurrent).not.toThrow();
        setRuntimeConfigSnapshot({
          tools: { exec: { host: "gateway", security: "deny", ask: "off" } },
        });
        expect(assertCurrent).toThrow("policy changed");
      },
    );
  } finally {
    clearRuntimeConfigSnapshot();
  }
});

it("keeps Browser callable while requiring the live host's native execution declaration", async () => {
  const config = {
    tools: { gatewayPolicy: { allow: ["browser"], actions: { browser: ["snapshot"] } } },
  };
  const { hostCapabilities, closeHost, closeAdmission } =
    await createAdmittedHostCapabilityTestFixture({
      runId: "browser-native-execution",
      config,
    });
  const plugins = vi
    .spyOn(omnipolymathPluginTools, "resolveOmnipolymathPluginToolsForOptionsAsync")
    .mockResolvedValue([]);
  try {
    for (const nativeLocalExecution of [undefined, true] as const) {
      vi.mocked(createOmnipolymathTools).mockClear();
      const tools = await hostCapabilities.createToolSurfaceAsync!(
        {
          config,
          sessionPermissionPolicy: { mode: "full", root: process.cwd() },
        },
        { nativeLocalExecution },
      );
      expect(tools.some((tool) => tool.name === "browser")).toBe(true);
      expect(tools.some((tool) => tool.name === "exec")).toBe(false);
      const { context } = resolveOmnipolymathPluginToolInputs({
        options: vi.mocked(createOmnipolymathTools).mock.calls.at(-1)?.[0],
      });
      expect(context.browser.allowLocalLoopback).toBe(nativeLocalExecution === true);
    }
  } finally {
    plugins.mockRestore();
    closeHost();
    closeAdmission();
  }
});
