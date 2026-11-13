import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDirTracker } from "../../test/helpers/temp-dir.js";
import { initializeNativeSessionCatalogPreferences } from "../plugins/native-session-catalog-config.js";
import type { ConfigValidationIssue, OmnipolymathConfig } from "./types.js";
import { validateExplicitPluginConfig } from "./validation-plugin-config.js";
import { preparePluginSchemaValidations } from "./validation-prepared.js";

const roots = createTempDirTracker();
afterEach(() => {
  vi.unstubAllEnvs();
  roots.cleanup();
});

function missingPluginWarningPaths(config: OmnipolymathConfig): string[] {
  const home = roots.make("omnipolymath-catalog-preference-warnings-");
  vi.stubEnv("OMNIPOLYMATH_HOME", home);
  vi.stubEnv("OMNIPOLYMATH_STATE_DIR", home);
  const warnings: ConfigValidationIssue[] = [];
  const issues: ConfigValidationIssue[] = [];
  validateExplicitPluginConfig({
    raw: config,
    config,
    env: { HOME: home, OMNIPOLYMATH_HOME: home, OMNIPOLYMATH_STATE_DIR: home },
    applyDefaults: false,
    registry: { plugins: [], diagnostics: [] },
    schemaValidations: preparePluginSchemaValidations(),
    ensureCompatPluginIds: () => new Set(),
    ensureOverriddenPluginIds: () => new Set(),
    replacePluginEntryConfig: () => {
      throw new Error("An absent plugin cannot replace config through its schema");
    },
    issues,
    warnings,
  });
  expect(issues).toEqual([]);
  return warnings.map(({ path }) => path);
}

describe("native catalog preferences without installed plugins", () => {
  it("does not diagnose first-write privacy defaults as missing plugins", () => {
    const config = initializeNativeSessionCatalogPreferences({});
    expect(missingPluginWarningPaths(config)).toEqual([]);
  });

  const explicitUsageCases: Array<{
    name: string;
    config: OmnipolymathConfig;
    warningPath: string;
  }> = [
    {
      name: "explicit enablement",
      config: { plugins: { entries: { anthropic: { enabled: true } } } },
      warningPath: "plugins.entries.anthropic",
    },
    {
      name: "independent allowlist selection",
      config: { plugins: { allow: ["anthropic"] } },
      warningPath: "plugins.allow",
    },
    {
      name: "additional authored plugin configuration",
      config: {
        plugins: { entries: { anthropic: { config: { additionalSetting: "authored" } } } },
      },
      warningPath: "plugins.entries.anthropic",
    },
    {
      name: "an undeclared plugin with the same setting shape",
      config: {
        plugins: {
          entries: { "external-fixture": { config: { sessionCatalog: { enabled: false } } } },
        },
      },
      warningPath: "plugins.entries.external-fixture",
    },
  ];
  it.each(explicitUsageCases)(
    "retains missing-plugin warnings for $name",
    ({ config, warningPath }) => {
      const initialized = initializeNativeSessionCatalogPreferences(config);
      expect(missingPluginWarningPaths(initialized)).toEqual([warningPath]);
    },
  );
});
