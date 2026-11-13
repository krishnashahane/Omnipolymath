import path from "node:path";
import { afterAll, afterEach, expect, it } from "vitest";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { withEnvAsync } from "../test-utils/env.js";
import { pluginFixtureConfig } from "./loader-fixture-builders.test-support.js";
import {
  cleanupPluginLoaderFixturesForTest,
  loadOmnipolymathPlugins,
  makePluginLoaderTempDir,
  resetPluginLoaderTestStateForTest,
  writePlugin,
} from "./loader.test-fixtures.js";
import { createPluginCache, withPluginCache } from "./plugin-cache.js";
import { loadPluginMetadataSnapshot } from "./plugin-metadata-snapshot.js";
import {
  getPluginRuntimeLoadContext,
  getReusablePluginRuntimeActivation,
} from "./runtime/load-context.js";

afterEach(resetPluginLoaderTestStateForTest);
afterAll(cleanupPluginLoaderFixturesForTest);

async function fixture(run: (root: string, env: NodeJS.ProcessEnv) => Promise<void>) {
  const root = makePluginLoaderTempDir();
  const env = {
    OMNIPOLYMATH_STATE_DIR: path.join(root, "state"),
    OMNIPOLYMATH_DISABLE_BUNDLED_PLUGINS: "1",
  };
  await using cache = createPluginCache();
  await withEnvAsync(env, () => withPluginCache(cache, () => run(root, env)));
}

it.each([false, true])("binds the supplied inventory to scoped facts (empty scope=%s)", (empty) =>
  fixture(async (root, env) => {
    const id = "scoped-inventory";
    const plugin = writePlugin({
      id,
      dir: path.join(root, id),
      registration: `api.registerProvider({ id: "${id}", label: "${id}", auth: [] });`,
    });
    const workspaceDir = path.join(root, "workspace");
    const config = pluginFixtureConfig(plugin, { enabled: true });
    const context = { config, env, workspaceDir };
    const metadataSnapshot = loadPluginMetadataSnapshot({ ...context, allowCurrent: false });
    const options = {
      ...context,
      metadataSnapshot,
      onlyPluginIds: empty ? [] : [id],
      activate: false,
      throwOnLoadError: true,
    };
    const registry = loadOmnipolymathPlugins(options);
    // Catalog workers reuse these facts instead of rerunning setup auto-enable.
    expect(getPluginRuntimeLoadContext(registry)?.metadataSnapshot).toBe(metadataSnapshot);
    expect(
      getReusablePluginRuntimeActivation(registry, { ...context, metadataSnapshot }),
    ).toBeDefined();
    if (!empty) {
      expect(loadOmnipolymathPlugins(options)).toBe(registry);
      expect(
        loadOmnipolymathPlugins({ ...options, metadataSnapshot: { ...metadataSnapshot } }),
      ).not.toBe(registry);
    }
  }),
);

it("pins supplied inventory without relabeling a conflicting explicit source", () =>
  fixture(async (root, env) => {
    const id = "inventory-owner";
    const sources = ["A", "B"].map((label) =>
      writePlugin({
        id,
        dir: path.join(root, label),
        registration: `api.registerProvider({ id: "inventory-owner", label: ${JSON.stringify(label)}, auth: [] });`,
      }),
    );
    const config: OmnipolymathConfig = { plugins: { allow: [id], slots: { memory: "none" } } };
    const snapshots = sources.map((source) =>
      loadPluginMetadataSnapshot({
        config: { ...config, plugins: { ...config.plugins, load: { paths: [source.file] } } },
        env,
        allowCurrent: false,
      }),
    );
    const [metadataA, metadataB] = snapshots;
    if (!metadataA || !metadataB) {
      throw new Error("Missing fixture inventory");
    }
    const options = { config, env, onlyPluginIds: [id], activate: false, throwOnLoadError: true };
    const admitted = loadOmnipolymathPlugins({ ...options, metadataSnapshot: metadataA });
    expect(admitted.providers.map(({ provider }) => provider.label)).toEqual(["A"]);
    const replacement = loadOmnipolymathPlugins({ ...options, metadataSnapshot: metadataB });
    expect(replacement.providers.map(({ provider }) => provider.label)).toEqual(["B"]);
    const conflicting = loadOmnipolymathPlugins({
      ...options,
      metadataSnapshot: metadataA,
      manifestRegistry: metadataB.manifestRegistry,
    });
    expect(conflicting.providers.map(({ provider }) => provider.label)).toEqual(["B"]);
    expect(getPluginRuntimeLoadContext(conflicting)?.metadataSnapshot).toBeUndefined();
    expect(getPluginRuntimeLoadContext(admitted)?.metadataSnapshot).toBe(metadataA);
  }));
