import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { createScriptTestHarness } from "./test-helpers.js";
const SCRIPT_PATH = path.resolve("scripts/test-live-cli-backend-docker.sh");
const { createTempDir } = createScriptTestHarness();
function runDockerFixture(prefix: string, env: Record<string, string>) {
  const root = createTempDir(prefix);
  for (const dir of ["scripts", "bin", "home"]) {
    mkdirSync(path.join(root, dir));
  }
  symlinkSync(path.resolve("scripts/lib"), path.join(root, "scripts/lib"));
  for (const target of ["scripts/test-live-build-docker.sh", "bin/node"]) {
    symlinkSync("/usr/bin/true", path.join(root, target));
  }
  const capture = path.join(root, "docker-args");
  writeFileSync(path.join(root, "bin/docker"), '#!/bin/bash\nprintf "%s\\0" "$@" >"$CAPTURE"\n', {
    mode: 0o755,
  });
  writeFileSync(
    path.join(root, "bin/timeout"),
    '#!/bin/bash\nif [[ "$1" = --kill-after=1s ]]; then exit 0; fi\nshift 2\nexec "$@"\n',
    { mode: 0o755 },
  );
  const result = spawnSync("/bin/bash", [SCRIPT_PATH], {
    encoding: "utf8",
    env: {
      HOME: path.join(root, "home"),
      PATH: `${path.join(root, "bin")}:${process.env.PATH}`,
      CAPTURE: capture,
      OMNIPOLYMATH_LIVE_DOCKER_TRUSTED_HARNESS_DIR: root,
      OMNIPOLYMATH_LIVE_CLI_BACKEND_MODEL: "claude-cli/fixture",
      ...env,
    },
  });
  return { result, capture };
}

it("validates setup early and forwards argument overrides into Docker", () => {
  const invalid = spawnSync("/bin/bash", [SCRIPT_PATH], {
    encoding: "utf8",
    env: { ...process.env, OMNIPOLYMATH_LIVE_CLI_BACKEND_SETUP_TIMEOUT_SECONDS: "180s" },
  });
  expect(invalid.status).toBe(2);
  expect(invalid.stderr).toContain("invalid OMNIPOLYMATH_LIVE_CLI_BACKEND_SETUP_TIMEOUT_SECONDS: 180s");
  expect(invalid.stderr).not.toMatch(/Cannot find package 'tsx'|docker/);
  const controls = [
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_ARGS",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_RESUME_ARGS",
    "OMNIPOLYMATH_TEST_CONSOLE",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_CACHE_PROBE",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_ADVISORY",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_ALLOW_PROVIDER_SKIP",
  ];
  const { result, capture } = runDockerFixture(
    "omnipolymath-live-cli-capture-",
    Object.fromEntries(controls.map((key) => [key, "forwarded"])),
  );
  expect(result.status, result.stderr).toBe(0);
  const argv = readFileSync(capture, "utf8").split("\0");
  expect(argv[0]).toBe("run");
  const forwardedEnv = argv.flatMap((arg, index) => (arg === "-e" ? [argv[index + 1]] : []));
  for (const key of controls) {
    expect(forwardedEnv).toContain(`${key}=forwarded`);
  }
  expect(forwardedEnv.filter((value) => value?.startsWith("OMNIPOLYMATH_LIVE_CLI_BACKEND_"))).toEqual([
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_SETUP_TIMEOUT_SECONDS=180",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_DEBUG=",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_ADVISORY=forwarded",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_ALLOW_PROVIDER_SKIP=forwarded",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_MODEL=claude-cli/fixture",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_COMMAND=",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_ARGS=forwarded",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_RESUME_ARGS=forwarded",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_CLEAR_ENV=",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_DISABLE_MCP_CONFIG=0",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_CACHE_PROBE=forwarded",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_RESUME_PROBE=",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_MODEL_SWITCH_PROBE=0",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_IMAGE_PROBE=0",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_MCP_PROBE=0",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_MCP_SCHEMA_PROBE=",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_IMAGE_ARG=",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_IMAGE_MODE=",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_AUTH=auto",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_ANTHROPIC_API_KEY=",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_ANTHROPIC_API_KEY_OLD=",
    "OMNIPOLYMATH_LIVE_CLI_BACKEND_PRESERVE_ENV=",
  ]);
});

it("passes only subscription credentials to a Claude subscription container", () => {
  const { result, capture } = runDockerFixture("omnipolymath-live-cli-subscription-", {
    OMNIPOLYMATH_LIVE_CLI_BACKEND_AUTH: "subscription",
    CLAUDE_CODE_OAUTH_TOKEN: "synthetic-subscription-token",
    ANTHROPIC_API_KEY: "synthetic-api-key",
  });

  expect(result.status, result.stderr).toBe(0);
  const argv = readFileSync(capture, "utf8").split("\0");
  const forwardedEnv = argv.flatMap((arg, index) => (arg === "-e" ? [argv[index + 1]] : []));
  expect(forwardedEnv).toContain("CLAUDE_CODE_OAUTH_TOKEN=synthetic-subscription-token");
  expect(forwardedEnv).not.toContain("ANTHROPIC_API_KEY");
  expect(forwardedEnv).not.toContain("ANTHROPIC_API_KEY=synthetic-api-key");
});
