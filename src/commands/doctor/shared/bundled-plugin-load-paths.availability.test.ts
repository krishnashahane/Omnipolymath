import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../../test/helpers/temp-dir.js";
import { writeFixtureJsonSync } from "../../../cli/cli-fixtures.test-support.js";
import type { OmnipolymathConfig } from "../../../config/types.omnipolymath.js";
import { discoverConfiguredPluginLoadPaths } from "../../../plugins/discovery.js";
import { clearPluginMetadataLifecycleCaches } from "../../../plugins/plugin-metadata-lifecycle.js";
import { maybeRepairBundledPluginLoadPaths } from "./bundled-plugin-load-paths.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
beforeEach(clearPluginMetadataLifecycleCaches);
afterEach(clearPluginMetadataLifecycleCaches);

it("preserves missing packaged aliases while removing inspected aliases and retaining custom duplicates", () => {
  const stateDir = tempDirs.make("omnipolymath-alias-availability-");
  const bundledRoot = path.join(
    stateDir,
    "current",
    "node_modules",
    "omnipolymath",
    "dist",
    "extensions",
  );
  const healthyAlias = path.join(bundledRoot, "alias-demo");
  fs.mkdirSync(healthyAlias, { recursive: true });
  writeFixtureJsonSync(path.join(healthyAlias, "omnipolymath.plugin.json"), {
    id: "alias-demo",
    configSchema: {},
  });
  writeFixtureJsonSync(path.join(healthyAlias, "package.json"), {
    name: "@fixture/alias-demo",
    version: "1.0.0",
    omnipolymath: { extensions: ["./index.cjs"] },
  });
  fs.writeFileSync(path.join(healthyAlias, "index.cjs"), "module.exports = {};\n");
  const missingAlias = path.join(
    stateDir,
    "old",
    "node_modules",
    "omnipolymath",
    "dist",
    "extensions",
    "alias-demo",
  );
  const customPath = path.join(stateDir, "custom-plugin");
  const paths = [missingAlias, healthyAlias, customPath, customPath];
  const config: OmnipolymathConfig = { plugins: { load: { paths } } };
  const env = {
    ...process.env,
    HOME: stateDir,
    OMNIPOLYMATH_HOME: stateDir,
    OMNIPOLYMATH_STATE_DIR: stateDir,
    OMNIPOLYMATH_DISABLE_BUNDLED_PLUGINS: "0",
    OMNIPOLYMATH_BUNDLED_PLUGINS_DIR: bundledRoot,
    OMNIPOLYMATH_TEST_TRUST_BUNDLED_PLUGINS_DIR: "1",
    OMNIPOLYMATH_DISABLE_BUNDLED_SOURCE_OVERLAYS: "1",
    OMNIPOLYMATH_DEV_SOURCE_ROOT: "",
  };
  const discovery = discoverConfiguredPluginLoadPaths({ loadPaths: paths, env });
  expect(discovery.diagnostics).toContainEqual(
    expect.objectContaining({ source: missingAlias, configDisposition: "preserve" }),
  );

  const result = maybeRepairBundledPluginLoadPaths(config, env);
  expect(result.config.plugins?.load?.paths).toEqual([missingAlias, customPath, customPath]);
  expect(result.changes).toEqual([
    `- plugins.load.paths: removed bundled alias-demo path alias ${healthyAlias}`,
  ]);
});
