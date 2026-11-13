import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createFixtureLifetime } from "../../test/helpers/fixture-lifetime.js";
import {
  createBuiltRuntime,
  runBuiltRuntime,
} from "../commands/doctor-config-preflight.process.test-support.js";
import { resolveRuntimeWorkerUrl } from "../infra/runtime-worker-url.js";
import { cliRecoveryEntrypoints } from "./cli-entrypoint.test-support.js";
import { getCliProcessTestTimeout } from "./cli-process-child.test-helpers.js";

const fixtures = createFixtureLifetime();
const childTimeoutMs = 60_000;
let runtimeRoot: string;
let compileCache: string;

beforeAll(() => {
  const entry = resolveRuntimeWorkerUrl(cliRecoveryEntrypoints.cli);
  runtimeRoot = createBuiltRuntime(
    fixtures.createTempDir("config-legacy-runtime-"),
    path.dirname(fileURLToPath(entry)),
  );
  compileCache = fixtures.createTempDir("config-legacy-compile-cache-");
});
afterAll(() => fixtures.cleanup());

it.each([
  ["config", "validate", "--json"],
  ["config", "get", "gateway.mode", "--json"],
])(
  "reports removed settings through %j without changing config or creating state",
  async (...args) => {
    const home = fixtures.createTempDir("config-legacy-home-");
    const configPath = path.join(home, "omnipolymath.json");
    const stateDir = path.join(home, "state");
    const tmpDir = path.join(home, "tmp");
    fs.mkdirSync(tmpDir);
    const original = JSON.stringify({
      gateway: { mode: "local" },
      skills: { workshop: { approvalPolicy: "pending" } },
    });
    fs.writeFileSync(configPath, original);
    const result = await fixtures.track(
      runBuiltRuntime(
        runtimeRoot,
        {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          OMNIPOLYMATH_HOME: home,
          OMNIPOLYMATH_STATE_DIR: stateDir,
          OMNIPOLYMATH_CONFIG_PATH: configPath,
          OMNIPOLYMATH_NO_RESPAWN: "1",
          OMNIPOLYMATH_HIDE_BANNER: "1",
          TMPDIR: tmpDir,
          NODE_COMPILE_CACHE: compileCache,
          NODE_DISABLE_COMPILE_CACHE: undefined,
          VITEST: undefined,
          VITEST_POOL_ID: undefined,
          VITEST_WORKER_ID: undefined,
        },
        args,
        childTimeoutMs,
      ),
    );
    expect(result.code, result.stderr).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.error.message).toMatch(/^Omnipolymath config is invalid: [^\n]+$/);
    expect(output.repairHint).toContain("omnipolymath doctor --fix");
    expect(output.issues).toContainEqual(
      expect.objectContaining({
        // The whole core key is retired; its settings moved to the skill-workshop plugin.
        path: "skills",
        message: expect.stringContaining("workshop"),
      }),
    );
    expect(fs.readFileSync(configPath, "utf8")).toBe(original);
    expect(fs.existsSync(stateDir)).toBe(false);
  },
  getCliProcessTestTimeout(childTimeoutMs),
);
