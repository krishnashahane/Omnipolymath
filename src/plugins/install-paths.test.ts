import fs from "node:fs";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import {
  resolveDefaultPluginExtensionsDir,
  resolveDefaultPluginGitDir,
  resolveDefaultPluginNpmDir,
  resolvePluginNpmGenerationProjectDir,
} from "./install-paths.js";
import { resolvePluginInstallRoots, withPluginInstallRoots } from "./install-root-context.js";
import {
  resolveInstalledPluginIndexStateDatabaseOptions,
  resolveInstalledPluginIndexStorePath,
} from "./installed-plugin-index-store-path.js";

const artifactDirs = [
  [resolveDefaultPluginExtensionsDir, "extensions"],
  [resolveDefaultPluginNpmDir, "npm"],
  [resolveDefaultPluginGitDir, "git"],
] as const;

function expectRoots(env: NodeJS.ProcessEnv, root: string) {
  for (const [resolve, kind] of artifactDirs) {
    expect(resolve(env)).toBe(`${root}/${kind}`);
  }
  expect(resolveInstalledPluginIndexStorePath({ env })).toBe(`${root}/state/omnipolymath.sqlite`);
  expect(resolveInstalledPluginIndexStateDatabaseOptions({ env }).env?.OMNIPOLYMATH_STATE_DIR).toBe(
    root,
  );
}

it.each([
  { env: { OMNIPOLYMATH_HOME: "/operator/home" }, root: "/operator/home/.omnipolymath" },
  { env: { OMNIPOLYMATH_CONFIG_PATH: "/operator/config/omnipolymath.json" }, root: "/operator/config" },
])("resolves artifact directories without probing state locations ($root)", ({ env, root }) => {
  using exists = vi.spyOn(fs, "existsSync").mockReturnValue(false);
  for (const [resolve, kind] of artifactDirs) {
    expect(resolve(env, () => "/unused-home")).toBe(path.resolve(root, kind));
  }
  expect(exists).not.toHaveBeenCalled();
});

it("isolates concurrent operator roots from redirected state and restores them on exit", async () => {
  const redirectedEnv = { OMNIPOLYMATH_STATE_DIR: "/tmp/ephemeral-run" };
  await Promise.all(
    ["/operator/one", "/operator/two"].map((stateDir) =>
      withPluginInstallRoots(
        resolvePluginInstallRoots({ OMNIPOLYMATH_STATE_DIR: stateDir }),
        async () => {
          await setImmediate();
          expectRoots(redirectedEnv, stateDir);
        },
      ),
    ),
  );
  expectRoots(redirectedEnv, "/tmp/ephemeral-run");
});

it("keeps generation project names compact for nested Windows runtime binaries", () => {
  const packageName = "@omnipolymath/codex";
  const projectDir = resolvePluginNpmGenerationProjectDir({
    npmDir: String.raw`C:\Users\Administrator\.omnipolymath\npm`,
    packageName,
    generationKey: `${packageName}\n2026.6.10\n${packageName}@2026.6.10\nsha512-test-integrity\ncodexshasum`,
  });
  const projectName = path.basename(projectDir);

  expect(projectName).toMatch(
    /^omnipolymath-codex-[a-f0-9]{10}__omnipolymath-generation__g-[a-f0-9]{16}$/u,
  );

  const nestedCodexBinaryPath = path.win32.join(
    String.raw`C:\Users\Administrator\.omnipolymath\npm\projects`,
    projectName,
    "node_modules/@omnipolymath/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
  );
  expect(nestedCodexBinaryPath.length).toBeLessThan(260);
});
