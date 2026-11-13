// Verifies shell environment key metadata used by config IO.
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeJsonFile } from "../../test/helpers/temp-repo.js";
import {
  createGeneratedPluginTempRoot,
  installGeneratedPluginTempRootCleanup,
} from "../plugins/generated-plugin-test-helpers.js";
import { createConfigIO } from "./io.js";

const loadShellEnvFallback = vi.hoisted(() =>
  vi.fn<typeof import("../infra/shell-env.js").loadShellEnvFallback>(),
);

vi.mock("../infra/shell-env.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../infra/shell-env.js")>()),
  loadShellEnvFallback,
}));

installGeneratedPluginTempRootCleanup();

describe("config io shell env expected keys", () => {
  beforeEach(() => {
    loadShellEnvFallback.mockClear();
  });

  it("includes env keys from a configured plugin without executing its runtime", async () => {
    const home = createGeneratedPluginTempRoot("omnipolymath-shell-env-metadata-");
    const pluginDir = path.join(home, "configured-plugin");
    const configPath = path.join(home, "state", "omnipolymath.json");
    writeJsonFile(path.join(pluginDir, "omnipolymath.plugin.json"), {
      id: "shell-fixture",
      providers: ["shell-fixture"],
      channels: ["shell-fixture"],
      channelConfigs: { "shell-fixture": { schema: { type: "object" } } },
      setup: {
        requiresRuntime: false,
        providers: [{ id: "shell-fixture", envVars: ["SHELL_FIXTURE_PROVIDER_KEY"] }],
      },
      configSchema: { type: "object", properties: {} },
    });
    writeJsonFile(path.join(pluginDir, "package.json"), {
      name: "shell-fixture",
      version: "1.0.0",
      omnipolymath: {
        extensions: ["./index.js"],
        channel: {
          id: "shell-fixture",
          configuredState: {
            env: {
              allOf: ["SHELL_FIXTURE_CHANNEL_KEY"],
              anyOf: ["SHELL_FIXTURE_PROVIDER_KEY"],
            },
          },
        },
      },
    });
    fs.writeFileSync(path.join(pluginDir, "index.js"), 'throw new Error("metadata only");\n');
    writeJsonFile(configPath, {
      env: { shellEnv: { enabled: true } },
      plugins: { allow: ["shell-fixture"], load: { paths: [pluginDir] } },
    });
    const env = {
      HOME: home,
      OMNIPOLYMATH_STATE_DIR: path.dirname(configPath),
      OMNIPOLYMATH_BUNDLED_PLUGINS_DIR: path.join(home, "empty-bundled"),
    };
    fs.mkdirSync(env.OMNIPOLYMATH_BUNDLED_PLUGINS_DIR);

    await createConfigIO({
      configPath,
      env,
      homedir: () => home,
      observe: false,
    }).readBestEffortConfig();

    expect(loadShellEnvFallback).toHaveBeenCalledOnce();
    const { expectedKeys } = loadShellEnvFallback.mock.calls[0]![0];
    expect(expectedKeys.filter((key) => key.startsWith("SHELL_FIXTURE_"))).toEqual([
      "SHELL_FIXTURE_PROVIDER_KEY",
      "SHELL_FIXTURE_CHANNEL_KEY",
    ]);
    expect(expectedKeys).toEqual(
      expect.arrayContaining(["OMNIPOLYMATH_GATEWAY_TOKEN", "OMNIPOLYMATH_GATEWAY_PASSWORD"]),
    );
  });
});
