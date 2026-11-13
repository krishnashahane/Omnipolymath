import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { OmnipolymathConfig } from "../../../config/types.omnipolymath.js";
import { validateConfigObjectWithPlugins } from "../../../config/validation.js";
import { createPluginCache, withPluginCache } from "../../../plugins/plugin-cache.js";
import { maybeRepairInvalidPluginConfig } from "./invalid-plugin-config.js";
import { findDoctorLegacyConfigIssues } from "./legacy-config-issues.js";

afterEach(() => vi.unstubAllEnvs());

it.each([true, false])(
  "preserves retired AgentsAPI ownership through Doctor repair when enabled=%s",
  (enabled) => {
    vi.stubEnv("OMNIPOLYMATH_BUNDLED_PLUGINS_DIR", path.resolve("extensions"));
    vi.stubEnv("OMNIPOLYMATH_TEST_TRUST_BUNDLED_PLUGINS_DIR", "1");
    vi.stubEnv("OMNIPOLYMATH_DISABLE_BUNDLED_PLUGINS", undefined);
    const config: OmnipolymathConfig = {
      plugins: {
        allow: ["agentsapi"],
        entries: {
          agentsapi: {
            enabled,
            config: { environment: "self_hosted", executorController: "original-controller" },
          },
        },
      },
    };
    const before = structuredClone(config);
    withPluginCache(createPluginCache(), () => {
      expect(findDoctorLegacyConfigIssues(config)).toContainEqual(
        expect.objectContaining({
          path: "plugins.entries.agentsapi.config.executorController",
          message: expect.stringContaining("previous Omnipolymath version"),
        }),
      );
      if (enabled) {
        expect(validateConfigObjectWithPlugins(config).ok).toBe(false);
      }
      expect(maybeRepairInvalidPluginConfig(config)).toEqual({ config: before, changes: [] });
    });
    expect(config).toEqual(before);
  },
);
