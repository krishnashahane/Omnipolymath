import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { applyPluginDoctorCompatibilityMigrations } from "./doctor-contract-registry.js";
import { clearPluginDoctorContractRegistryCache } from "./doctor-contract-registry.test-fixtures.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
beforeEach(clearPluginDoctorContractRegistryCache);
afterEach(clearPluginDoctorContractRegistryCache);

it.each([false, true])(
  "preserves uninspected config before a known plugin migration when another path is unavailable=%s",
  (unavailable) => {
    const stateDir = tempDirs.make("omnipolymath-doctor-unavailable-path-");
    const pluginRoot = path.join(stateDir, "known-plugin");
    fs.mkdirSync(pluginRoot);
    fs.writeFileSync(
      path.join(pluginRoot, "omnipolymath.plugin.json"),
      JSON.stringify({
        id: "known-plugin",
        configSchema: {},
        doctorContract: { configRepair: true },
      }),
    );
    fs.writeFileSync(path.join(pluginRoot, "index.cjs"), "module.exports = {};\n");
    fs.writeFileSync(
      path.join(pluginRoot, "doctor-contract-api.cjs"),
      `module.exports = {
  normalizeCompatibilityConfig({ cfg }) {
    const next = structuredClone(cfg);
    delete next.plugins.entries["known-plugin"].config.authored;
    return { config: next, changes: ["Removed the legacy plugin setting."] };
  },
};\n`,
    );
    const config: OmnipolymathConfig = {
      plugins: {
        load: {
          paths: [...(unavailable ? [path.join(stateDir, "missing-override")] : []), pluginRoot],
        },
        entries: { "known-plugin": { enabled: true, config: { authored: "preserve me" } } },
      },
    };
    const configPath = path.join(stateDir, "omnipolymath.json");
    const rawConfig = JSON.stringify(config, null, 2) + "\n";
    fs.writeFileSync(configPath, rawConfig);
    const result = applyPluginDoctorCompatibilityMigrations(config, {
      config,
      env: {
        ...process.env,
        HOME: stateDir,
        OMNIPOLYMATH_HOME: stateDir,
        OMNIPOLYMATH_STATE_DIR: stateDir,
        OMNIPOLYMATH_CONFIG_PATH: configPath,
        OMNIPOLYMATH_DISABLE_BUNDLED_PLUGINS: "1",
      },
    });

    if (unavailable) {
      expect(result).toEqual({ config, changes: [] });
      expect(JSON.stringify(result.config, null, 2) + "\n").toBe(rawConfig);
    } else {
      expect(result.changes).toEqual(["Removed the legacy plugin setting."]);
      expect(result.config.plugins?.entries?.["known-plugin"]?.config).toEqual({});
    }
  },
);
