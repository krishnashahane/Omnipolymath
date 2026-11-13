import { expect, it, vi } from "vitest";
import { applyPluginAutoEnable } from "../config/plugin-auto-enable.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import {
  resolveGatewayStartupPluginActivationConfig,
  resolveGatewayReloadPluginActivationCandidate,
} from "./plugin-activation-runtime-config.js";

// mock-isolation: Test config assembly with a controlled auto-enable result, without plugin discovery.
vi.mock("../config/plugin-auto-enable.js", () => ({ applyPluginAutoEnable: vi.fn() }));

const applyPluginAutoEnableMock = vi.mocked(applyPluginAutoEnable);
const autoEnable = (config: OmnipolymathConfig) =>
  applyPluginAutoEnableMock.mockReturnValue({ config, changes: [], autoEnabledReasons: {} });

it.each([true, false])(
  "merges source enablement (%s) without replacing runtime config",
  (enabled) => {
    const runtimeConfig: OmnipolymathConfig = {
      channels: { telegram: { enabled: !enabled, botToken: "runtime-token" } },
      plugins: { entries: { keep: { enabled: true, config: { runtimeOnly: 1 } } } },
    };
    const sourceConfig: OmnipolymathConfig = {
      plugins: { entries: { keep: { enabled: true } } },
    };
    const activation = {
      manifestRegistry: { plugins: [] } as never,
      discovery: { candidates: [] } as never,
      ambientEnvTriggers: "suppress" as const,
    };
    autoEnable({
      channels: { telegram: { enabled, botToken: "stale-source-token" } },
      plugins: { entries: { keep: { enabled }, added: { enabled: true } } },
    });

    const result = resolveGatewayStartupPluginActivationConfig({
      runtimeConfig,
      activationSourceConfig: sourceConfig,
      env: {},
      ...activation,
    });

    expect(applyPluginAutoEnableMock).toHaveBeenCalledWith(
      expect.objectContaining({ config: sourceConfig, ...activation }),
    );
    expect(result).toEqual({
      channels: { telegram: { enabled, botToken: "runtime-token" } },
      plugins: {
        entries: { keep: { enabled, config: { runtimeOnly: 1 } }, added: { enabled: true } },
      },
    });
  },
);

it("retains implicit provider and channel activation on a logging-only reload", () => {
  const sourceConfig: OmnipolymathConfig = { logging: { level: "debug" } };
  const autoEnabledConfig: OmnipolymathConfig = {
    ...sourceConfig,
    channels: { telegram: { enabled: true } },
    plugins: {
      allow: ["openai", "telegram"],
      entries: { openai: { enabled: true }, telegram: { enabled: true } },
    },
  };
  autoEnable(autoEnabledConfig);

  const result = resolveGatewayReloadPluginActivationCandidate({ sourceConfig, env: {} });

  expect(applyPluginAutoEnableMock).toHaveBeenCalledWith(
    expect.objectContaining({ config: sourceConfig }),
  );
  expect(result.plugins).toEqual(autoEnabledConfig.plugins);
  expect(result.channels?.telegram?.enabled).toBe(true);
});
