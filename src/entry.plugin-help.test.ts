import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../test/helpers/temp-dir.js";
import { tryHandleRootHelpFastPath } from "./entry.js";
import { tryHandleRootVersionFastPath } from "./entry.version-fast-path.js";
import * as pluginLoader from "./plugins/loader.js";
import * as manifests from "./plugins/manifest-registry.js";
import { withEnvAsync } from "./test-utils/env.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => vi.restoreAllMocks());

it.each(["inert", "legacy", "manifest", "invalid"] as const)(
  "prints root help and version without loading %s plugin runtimes",
  async (kind) => {
    const root = tempDirs.make("omnipolymath-help-plugins-");
    const configPath = path.join(root, "omnipolymath.json");
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "help-fixture", omnipolymath: { extensions: ["./index.cjs"] } }),
    );
    fs.writeFileSync(path.join(root, "index.cjs"), "module.exports = { register() {} };");
    fs.writeFileSync(
      path.join(root, "omnipolymath.plugin.json"),
      JSON.stringify({
        id: "help-fixture",
        configSchema: { type: "object", properties: {} },
        ...(kind === "manifest"
          ? {
              cliCommands: [
                { name: "fixture-command", description: "Fixture command", hasSubcommands: false },
              ],
            }
          : {}),
      }),
    );
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        ...(kind === "invalid" ? { gateway: { port: "invalid" } } : {}),
        models: {
          providers: { "help-fixture": { baseUrl: "https://example.invalid", models: [] } },
        },
        plugins: kind === "inert" ? {} : { allow: ["help-fixture"], load: { paths: [root] } },
      }),
    );
    const loadRuntime = vi.spyOn(pluginLoader, "loadOmnipolymathPluginCliRegistry");
    const loadManifest = vi.spyOn(manifests, "loadPluginManifestRegistryCore");
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await withEnvAsync(
      {
        HOME: root,
        OMNIPOLYMATH_STATE_DIR: path.join(root, "state"),
        OMNIPOLYMATH_CONFIG_PATH: configPath,
        OMNIPOLYMATH_DISABLE_BUNDLED_PLUGINS: kind === "inert" ? undefined : "1",
        OMNIPOLYMATH_BUNDLED_PLUGINS_DIR: undefined,
      },
      async () => {
        expect(await tryHandleRootHelpFastPath(["node", "omnipolymath", "--help"])).toBe(true);
        const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
        expect(output).toContain("Usage: omnipolymath");
        expect(output.includes("fixture-command")).toBe(kind === "manifest");
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        expect(tryHandleRootVersionFastPath(["node", "omnipolymath", "--version"])).toBe(true);
        await vi.waitFor(() =>
          expect(log).toHaveBeenCalledWith(expect.stringContaining("Omnipolymath")),
        );
        expect(loadRuntime).not.toHaveBeenCalled();
        if (kind === "inert") {
          expect(loadManifest).not.toHaveBeenCalled();
        }
      },
    );
  },
);
