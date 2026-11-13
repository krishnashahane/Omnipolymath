import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { writeFixtureJson } from "./cli-fixtures.test-support.js";
import { runCliProcessChild } from "./cli-process-child.test-helpers.js";
import {
  closeActiveGatewayServers,
  startStateDirStatusGateway,
} from "./gateway-backed-exit.test-helpers.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

afterEach(async () => {
  await closeActiveGatewayServers();
});

describe("CLI Gateway state target guard", () => {
  it("refuses a model credential write when the live Gateway reports another state tree", async () => {
    const root = tempDirs.make("omnipolymath-auth-state-mismatch-");
    const stateDir = path.join(root, "cli-state");
    const configPath = path.join(stateDir, "omnipolymath.json");
    const gatewayStateDir = path.join(root, "gateway-state");
    const gateway = await startStateDirStatusGateway({
      stateDir: gatewayStateDir,
      configPath: path.join(gatewayStateDir, "omnipolymath.json"),
    });
    await fs.mkdir(stateDir, { recursive: true });
    await writeFixtureJson(configPath, {
      gateway: {
        mode: "local",
        port: Number(new URL(gateway.url).port),
        auth: { mode: "none" },
      },
    });

    const result = await runCliProcessChild({
      nodeArgs: [
        "--import",
        "tsx",
        "src/entry.ts",
        "models",
        "--json",
        "auth",
        "paste-token",
        "--provider",
        "test-provider",
      ],
      env: {
        ...process.env,
        HOME: root,
        USERPROFILE: root,
        NODE_DISABLE_COMPILE_CACHE: "1",
        NODE_ENV: undefined,
        NODE_OPTIONS: undefined,
        OMNIPOLYMATH_CONFIG_PATH: configPath,
        OMNIPOLYMATH_DISABLE_BUNDLED_PLUGINS: "1",
        OMNIPOLYMATH_GATEWAY_PASSWORD: undefined,
        OMNIPOLYMATH_GATEWAY_TOKEN: undefined,
        OMNIPOLYMATH_GATEWAY_URL: undefined,
        OMNIPOLYMATH_HOME: root,
        OMNIPOLYMATH_NO_RESPAWN: "1",
        OMNIPOLYMATH_STATE_DIR: stateDir,
        VITEST: undefined,
      },
      input: "not-a-real-token\n",
    });

    expect(result, JSON.stringify(result)).toMatchObject({ code: 1, signal: null });
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        type: "cli_error",
        message: expect.stringContaining("No credentials or configuration were written"),
      },
    });
    expect(result.stderr).toBe(
      "[omnipolymath] The CLI command failed.\n[omnipolymath] For help, run `omnipolymath doctor`.\n",
    );
    expect(JSON.parse(await fs.readFile(configPath, "utf8"))).not.toHaveProperty("auth.profiles");
  });
});
