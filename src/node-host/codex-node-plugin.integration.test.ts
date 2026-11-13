import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../config/io.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { resetPluginLoaderTestStateForTest } from "../plugins/loader.test-fixtures.js";
import { withTempDir } from "../test-utils/temp-dir.js";
import {
  ensureNodeHostPluginRegistry,
  listRegisteredNodeHostCapsAndCommands,
} from "./plugin-node-host.js";
import { resetNodeHostPluginRegistry } from "./plugin-node-host.test-support.js";

afterEach(() => {
  resetNodeHostPluginRegistry();
  resetPluginLoaderTestStateForTest();
  clearRuntimeConfigSnapshot();
  vi.unstubAllEnvs();
});

describe("Codex node command availability", () => {
  it.each(["missing", "disabled", "denied", "enabled"] as const)(
    "advertises the checkout plugin only when present and enabled (%s)",
    async (state) => {
      await withTempDir("omnipolymath-codex-node-", async (home) => {
        vi.stubEnv("HOME", home);
        vi.stubEnv("OMNIPOLYMATH_STATE_DIR", path.join(home, "state"));
        vi.stubEnv("OMNIPOLYMATH_CONFIG_PATH", path.join(home, "omnipolymath.json"));
        vi.stubEnv("OMNIPOLYMATH_DISABLE_BUNDLED_PLUGINS", state === "missing" ? "1" : "0");
        vi.stubEnv("OMNIPOLYMATH_BUNDLED_PLUGINS_DIR", path.resolve("extensions"));
        const config: OmnipolymathConfig = {
          plugins: {
            allow: ["codex"],
            ...(state === "denied" ? { deny: ["codex"] } : {}),
            entries: { codex: { enabled: state !== "disabled" } },
          },
        };
        setRuntimeConfigSnapshot(config);
        await ensureNodeHostPluginRegistry({
          config,
          env: process.env,
          onlyPluginIds: ["codex"],
        });
        const manifest = listRegisteredNodeHostCapsAndCommands({ config, env: process.env });
        expect(manifest.commands.includes("codex.exec-server.stdio.v1")).toBe(state === "enabled");
        expect(manifest.caps.includes("codex.exec-server")).toBe(state === "enabled");
      });
    },
  );
});
