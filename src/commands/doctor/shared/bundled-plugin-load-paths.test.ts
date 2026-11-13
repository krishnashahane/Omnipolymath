import path from "node:path";
import { bundledDistPluginRootAt } from "omnipolymath/plugin-sdk/test-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OmnipolymathConfig } from "../../../config/types.omnipolymath.js";
import * as bundledSources from "../../../plugins/bundled-sources.js";
import * as discovery from "../../../plugins/discovery.js";
import {
  collectBundledPluginLoadPathWarnings,
  maybeRepairBundledPluginLoadPaths,
  scanBundledPluginLoadPathMigrations,
} from "./bundled-plugin-load-paths.js";

function mockBundledSource(localPath: string) {
  vi.spyOn(bundledSources, "resolveBundledPluginSources").mockReturnValue(
    new Map([["feishu", { pluginId: "feishu", localPath, npmSpec: "@omnipolymath/feishu" }]]),
  );
}

function createPluginLoadPathConfig(paths: Array<string | number>): OmnipolymathConfig {
  return { plugins: { load: { paths } } } as unknown as OmnipolymathConfig;
}

const packageRoot = path.resolve("app-node-modules", "omnipolymath");
const legacyPath = path.join(packageRoot, "extensions", "feishu");
const bundledPath = bundledDistPluginRootAt(packageRoot, "feishu");
const currentBundledPath = bundledDistPluginRootAt(path.resolve("node_modules/omnipolymath"), "feishu");

describe("bundled plugin load path repair", () => {
  beforeEach(() => {
    // Layout cases use inspected metadata rather than filesystem discovery.
    vi.spyOn(discovery, "discoverConfiguredPluginLoadPaths").mockReturnValue({
      candidates: [],
      diagnostics: [],
    });
    mockBundledSource(bundledPath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes available bundled aliases from old versioned Omnipolymath package roots", () => {
    const stalePackageRoot = path.resolve(
      "pnpm-global/.pnpm/omnipolymath@2026.3.28_@napi-rs+canvas@0.1.97/node_modules/omnipolymath",
    );
    const staleBundledPath = bundledDistPluginRootAt(stalePackageRoot, "feishu");
    mockBundledSource(currentBundledPath);

    const result = maybeRepairBundledPluginLoadPaths(
      createPluginLoadPathConfig([staleBundledPath, "/custom/path", "/custom/path"]),
    );

    expect(result.changes).toEqual([
      `- plugins.load.paths: removed bundled feishu path alias ${staleBundledPath}`,
    ]);
    expect(result.config.plugins?.load?.paths).toStrictEqual(["/custom/path", "/custom/path"]);
  });

  it("preserves custom paths outside installed Omnipolymath package roots", () => {
    const customPath = path.resolve("elsewhere", "dist", "extensions", "feishu");
    mockBundledSource(currentBundledPath);

    const result = maybeRepairBundledPluginLoadPaths(createPluginLoadPathConfig([customPath]));

    expect(result.changes).toEqual([]);
    expect(result.config).toEqual(createPluginLoadPathConfig([customPath]));
  });

  it("preserves non-string path entries when repairing legacy bundled paths", () => {
    const result = maybeRepairBundledPluginLoadPaths(
      createPluginLoadPathConfig([legacyPath, 42, "/other/path"]),
    );

    expect(result.config.plugins?.load?.paths).toEqual([42, "/other/path"]);
  });

  it("formats a doctor hint for legacy bundled plugin paths", () => {
    const warnings = collectBundledPluginLoadPathWarnings({
      hits: scanBundledPluginLoadPathMigrations(createPluginLoadPathConfig([legacyPath])),
      doctorFixCommand: "omnipolymath doctor --fix",
    });

    expect(warnings).toEqual([
      `- plugins.load.paths: bundled plugin path "${legacyPath}" still aliases feishu; Omnipolymath loads the packaged bundled plugin from "${bundledPath}".`,
      '- Run "omnipolymath doctor --fix" to remove these redundant bundled plugin paths.',
    ]);
  });

  it("ignores bundled plugins that already resolve to source extensions", () => {
    const sourcePath = path.resolve("repo", "omnipolymath", "extensions", "feishu");
    mockBundledSource(sourcePath);

    expect(
      scanBundledPluginLoadPathMigrations(createPluginLoadPathConfig([sourcePath])),
    ).toStrictEqual([]);
  });
});
