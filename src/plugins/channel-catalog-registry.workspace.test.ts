import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createTempDirTracker } from "../../test/helpers/temp-dir.js";
import { writeJsonFile } from "../../test/helpers/temp-repo.js";
import { resolveConfigWidePluginMetadataSnapshot } from "../config/io.plugin-metadata.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { closeOmnipolymathStateDatabaseByPathAsync } from "../state/omnipolymath-state-db-cache.js";
import { listChannelCatalogEntries } from "./channel-catalog-registry.js";
import { setGatewayPluginMetadataSnapshot } from "./current-plugin-metadata-snapshot.js";
import { resolveInstalledPluginIndexStorePath } from "./installed-plugin-index-store-path.js";
import { refreshPersistedInstalledPluginIndex } from "./installed-plugin-index-store-write.js";
import { createPluginCache, withPluginCache } from "./plugin-cache.js";
import { clearPluginMetadataLifecycleCaches } from "./plugin-metadata-lifecycle.js";

const tempDirs = createTempDirTracker();
const databasePaths = new Set<string>();
afterEach(async () => {
  vi.restoreAllMocks();
  clearPluginMetadataLifecycleCaches();
  for (const databasePath of databasePaths) {
    await closeOmnipolymathStateDatabaseByPathAsync(databasePath);
  }
  databasePaths.clear();
  tempDirs.cleanup();
});

it("keeps the published install generation across ledger writes until restart", async () => {
  const root = tempDirs.make("omnipolymath-channel-ledger-");
  const env = { HOME: root, OMNIPOLYMATH_STATE_DIR: root, OMNIPOLYMATH_DISABLE_BUNDLED_PLUGINS: "1" };
  const initialRoot = path.join(root, "initial");
  const replacementRoot = path.join(root, "replacement");
  const config: OmnipolymathConfig = {};
  for (const rootDir of [initialRoot, replacementRoot]) {
    writeChannelPlugin(rootDir, "managed-channel");
  }
  const install = async (rootDir: string, installEnv = env) => {
    await refreshPersistedInstalledPluginIndex({
      config,
      env: installEnv,
      reason: "source-changed",
      installRecords: {
        "managed-channel": { source: "path", sourcePath: rootDir, installPath: rootDir },
      },
    });
    databasePaths.add(resolveInstalledPluginIndexStorePath({ env: installEnv }));
  };
  await install(initialRoot);
  const snapshot = resolveConfigWidePluginMetadataSnapshot({ config, env });
  setGatewayPluginMetadataSnapshot(snapshot, { config, env });
  const read = () => listChannelCatalogEntries({ env }).map((entry) => entry.rootDir);
  expect(read()).toEqual([initialRoot]);

  await install(replacementRoot);
  expect(read()).toEqual([initialRoot]);
  const foreign = tempDirs.make("omnipolymath-channel-foreign-ledger-");
  const foreignEnv = { ...env, HOME: foreign, OMNIPOLYMATH_STATE_DIR: foreign };
  await install(replacementRoot, foreignEnv);
  expect(listChannelCatalogEntries({ env: foreignEnv }).map((entry) => entry.rootDir)).toEqual([
    replacementRoot,
  ]);
  clearPluginMetadataLifecycleCaches();
  expect(read()).toEqual([replacementRoot]);
});

function writeChannelPlugin(rootDir: string, id: string): void {
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, "index.js"), "export default { register() {} };\n");
  writeJsonFile(path.join(rootDir, "omnipolymath.plugin.json"), {
    id,
    channels: [id],
    configSchema: { type: "object", properties: {} },
  });
  writeJsonFile(path.join(rootDir, "package.json"), {
    name: id,
    type: "module",
    omnipolymath: {
      extensions: ["./index.js"],
      channel: { id, name: id, description: `Synthetic ${id} channel` },
    },
  });
}

it("keeps channel catalog workspace and load-path scopes after Gateway publication", () => {
  const root = tempDirs.make("omnipolymath-channel-catalog-");
  const env = { HOME: root, OMNIPOLYMATH_STATE_DIR: root, OMNIPOLYMATH_DISABLE_BUNDLED_PLUGINS: "1" };
  const alpha = path.join(root, "alpha");
  const beta = path.join(root, "beta");
  const extra = path.join(root, "extra");
  writeChannelPlugin(path.join(alpha, ".omnipolymath/extensions/alpha-channel"), "alpha-channel");
  writeChannelPlugin(path.join(beta, ".omnipolymath/extensions/beta-channel"), "beta-channel");
  writeChannelPlugin(extra, "extra-channel");
  const config: OmnipolymathConfig = {
    agents: { entries: { alpha: { workspace: alpha }, beta: { workspace: beta } } },
    plugins: { load: { paths: [extra] } },
  };
  const scopes = [
    { workspaceDir: alpha, expected: ["alpha-channel"] },
    { workspaceDir: beta, expected: ["beta-channel"] },
    { workspaceDir: alpha, extraPaths: [extra], expected: ["alpha-channel", "extra-channel"] },
  ];
  const expectedEntries = scopes.map(({ expected }) => expected);
  const read = () =>
    scopes.map(({ expected: _expected, ...scope }) =>
      listChannelCatalogEntries({ ...scope, env })
        .map((entry) => entry.pluginId)
        .toSorted(),
    );
  expect(withPluginCache(createPluginCache(), read)).toEqual(expectedEntries);
  const snapshot = resolveConfigWidePluginMetadataSnapshot({ config, env });
  expect(snapshot.plugins.map((plugin) => plugin.id).toSorted()).toEqual([
    "alpha-channel",
    "beta-channel",
    "extra-channel",
  ]);
  setGatewayPluginMetadataSnapshot(snapshot, { config, env });

  const fileReads = [
    "existsSync",
    "statSync",
    "lstatSync",
    "realpathSync",
    "readFileSync",
    "readdirSync",
    "openSync",
    "fstatSync",
  ] as const;
  const probes = fileReads.map((method) => vi.spyOn(fs, method));
  expect(read()).toEqual(expectedEntries);
  expect(read()).toEqual(expectedEntries);
  expect(probes.map((probe) => probe.mock.calls.length)).toEqual(fileReads.map(() => 0));
  vi.restoreAllMocks();
  writeChannelPlugin(path.join(alpha, ".omnipolymath/extensions/late-channel"), "late-channel");
  expect(read()).toEqual(expectedEntries);
  clearPluginMetadataLifecycleCaches();
  expect(read()[0]).toEqual(["alpha-channel", "late-channel"]);
});

it("retains raw workspace shadows for catalog trust filtering after publication", () => {
  const root = tempDirs.make("omnipolymath-channel-shadow-");
  const env = { HOME: root, OMNIPOLYMATH_STATE_DIR: root, OMNIPOLYMATH_DISABLE_BUNDLED_PLUGINS: "1" };
  const workspaceDir = path.join(root, "workspace");
  writeChannelPlugin(path.join(root, "extensions/shadow-channel"), "shadow-channel");
  writeChannelPlugin(
    path.join(workspaceDir, ".omnipolymath/extensions/shadow-channel"),
    "shadow-channel",
  );
  const config: OmnipolymathConfig = { agents: { entries: { alpha: { workspace: workspaceDir } } } };
  const read = () =>
    listChannelCatalogEntries({ workspaceDir, env }).map(({ pluginId, origin }) => ({
      pluginId,
      origin,
    }));
  const expected = [
    { pluginId: "shadow-channel", origin: "workspace" },
    { pluginId: "shadow-channel", origin: "global" },
  ];
  expect(read()).toEqual(expected);
  const snapshot = resolveConfigWidePluginMetadataSnapshot({ config, env });
  setGatewayPluginMetadataSnapshot(snapshot, { config, env });
  expect(read()).toEqual(expected);
});
