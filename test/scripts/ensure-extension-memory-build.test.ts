// Ensure Extension Memory Build tests cover ensure extension memory build script behavior.
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureExtensionMemoryBuild,
  hasBuiltExtensionMemoryEntries,
} from "../../scripts/ensure-extension-memory-build.mts";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";
import { fixtureFiles } from "./script-fixture-files.test-support.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function makeFixture() {
  const files = fixtureFiles(tempDirs.make("omnipolymath-extension-memory-build-"));
  files.write("scripts/build-all.mts", "");
  return files;
}

describe("ensure-extension-memory-build", () => {
  it.each(["extensions/external/dist/index.js"])(
    "reuses selected built entry %s without building unrelated plugins",
    (entry) => {
      const { root, write } = makeFixture();
      write(entry, "export {};\n");
      write("extensions/internal/omnipolymath.plugin.json", '{"id":"internal"}');
      write("extensions/internal/index.ts", "export {};\n");
      write("extensions/external/index.ts", 'throw new Error("source imported");');

      const result = ensureExtensionMemoryBuild({
        rootDir: root,
        requiredExtensionIds: ["external"],
        env: { OMNIPOLYMATH_EXTENSION_MEMORY_BUILD_TIMEOUT_MS: "invalid" },
        spawnSync: () => {
          throw new Error("unexpected build");
        },
      });

      expect(result).toEqual({ built: false });
    },
  );

  it.each([
    [undefined, 2345],
    [3456, 3456],
  ] as const)("builds missing required ids with timeout %s", (timeoutMs, expectedTimeout) => {
    const { root, write } = makeFixture();
    write("dist/extensions/external/index.js", "export {};\n");
    write("dist/entry.js", "export {};\n");
    write("dist/cli-startup-metadata.json", "{}\n");
    let buildTimeout: number | undefined;
    expect(
      ensureExtensionMemoryBuild({
        rootDir: root,
        requiredExtensionIds: ["external", "internal"],
        env: {
          OMNIPOLYMATH_CLI_STARTUP_BUILD_TIMEOUT_MS: "1",
          OMNIPOLYMATH_EXTENSION_MEMORY_BUILD_TIMEOUT_MS: "2345",
        },
        timeoutMs,
        spawnSync: (_command, _args, options) => {
          buildTimeout = options?.timeout;
          return { status: 0 };
        },
      }),
    ).toEqual({ built: true });
    expect(buildTimeout).toBe(expectedTimeout);
  });

  it("requires all expected bundled entries by default even when local output exists", () => {
    const { root, write } = makeFixture();
    for (const id of ["internal-a", "internal-b", "external"]) {
      write(`extensions/${id}/omnipolymath.plugin.json`, JSON.stringify({ id }));
      write(`extensions/${id}/index.ts`, "export {};\n");
    }
    write(
      "extensions/external/package.json",
      JSON.stringify({ omnipolymath: { build: { bundledDist: false } } }),
    );
    write("extensions/external/dist/index.js", "export {};\n");
    write("dist/extensions/internal-a/index.js", "export {};\n");
    expect(hasBuiltExtensionMemoryEntries({ rootDir: root, env: {} })).toBe(false);
    write("dist/extensions/internal-b/index.js", "export {};\n");
    expect(hasBuiltExtensionMemoryEntries({ rootDir: root, env: {} })).toBe(true);
  });

  it("fails when the cliStartup build profile fails", () => {
    const { root } = makeFixture();

    expect(() =>
      ensureExtensionMemoryBuild({
        rootDir: root,
        spawnSync: () => ({ status: 1 }),
        stdio: "pipe",
      }),
    ).toThrow("cliStartup build profile failed with exit code 1");
  });
});
