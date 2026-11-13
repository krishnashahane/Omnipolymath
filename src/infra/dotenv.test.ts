import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCliDotEnv } from "../cli/dotenv.js";
import { deleteTestEnvValue, setTestEnvValue } from "../test-utils/env.js";
import { loadGlobalRuntimeDotEnvFiles } from "./dotenv-global.js";
import { loadDotEnv, loadWorkspaceDotEnvFile } from "./dotenv.js";
import { clearEnv, envContents, useDotEnvFixture, writeEnvFile } from "./dotenv.test-support.js";

const loggerMocks = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: vi.fn(() => loggerMocks),
}));

const CREDENTIAL_AND_GATEWAY_ENV_KEYS = `
  ANTHROPIC_API_KEY ANTHROPIC_API_KEY_SECONDARY ANTHROPIC_OAUTH_TOKEN
  OPENAI_API_KEY OPENAI_API_KEYS OPENAI_API_KEY_SECONDARY
  OMNIPOLYMATH_LIVE_ANTHROPIC_KEY OMNIPOLYMATH_LIVE_ANTHROPIC_KEYS OMNIPOLYMATH_LIVE_GEMINI_KEY
  OMNIPOLYMATH_LIVE_OPENAI_KEY OMNIPOLYMATH_GATEWAY_TOKEN OMNIPOLYMATH_GATEWAY_PASSWORD OMNIPOLYMATH_GATEWAY_SECRET
`
  .trim()
  .split(/\s+/);

const WINDOWS_SHELL_TRUST_ROOT_ENV_KEYS =
  "AppData ComSpec LocalAppData ProgramFiles ProgramW6432 SystemRoot windir"
    .split(" ")
    .flatMap((key) => [key, key.toUpperCase()]);

function expectEnvUndefined(keys: readonly string[]) {
  for (const key of keys) {
    expect(process.env[key]).toBeUndefined();
  }
}

const fixture = useDotEnvFixture();
beforeEach(() => clearEnv(["FOO", "BAR"]));
const writeState = (contents: string) =>
  writeEnvFile(path.join(fixture.stateDir, ".env"), contents);
const writeWorkspace = (contents: string) =>
  writeEnvFile(path.join(fixture.cwdDir, ".env"), contents);

async function expectBlockedWorkspaceEnv(lines: readonly string[]) {
  const keys = lines.map((line) => line.split("=")[0] ?? "");
  await writeWorkspace(lines.join("\n"));
  clearEnv(keys);
  loadWorkspaceDotEnvFile(path.join(fixture.cwdDir, ".env"));
  expectEnvUndefined(keys);
}

describe("loadDotEnv", () => {
  it.each([
    ["CWD", "from-cwd"],
    ["shell", "from-shell"],
  ])("keeps %s precedence over the global fallback", async (source, expected) => {
    await writeState("FOO=from-global\nBAR=1\n");
    await writeWorkspace("FOO=from-cwd\n");
    if (source === "shell") {
      process.env.FOO = "from-shell";
    }
    loadDotEnv();
    expect(process.env).toMatchObject({ FOO: expected, BAR: "1" });
  });

  it("lets the state dotenv replace only explicitly service-managed inherited values", async () => {
    await writeState("MANAGED_API_KEY=from-state\nOPERATOR_API_KEY=from-state\n");
    process.env.MANAGED_API_KEY = "stale-service-value";
    process.env.OPERATOR_API_KEY = "operator-service-value";

    const loaded = loadGlobalRuntimeDotEnvFiles({
      stateEnvPath: path.join(fixture.stateDir, ".env"),
      overrideKeys: ["MANAGED_API_KEY"],
    });

    expect(process.env).toMatchObject({
      MANAGED_API_KEY: "from-state",
      OPERATOR_API_KEY: "operator-service-value",
    });
    expect(loaded.dotenvPresentKeys).toEqual(["MANAGED_API_KEY", "OPERATOR_API_KEY"]);
  });

  it("loads global env when the working directory was deleted", async () => {
    await writeState("FOO=from-global\n");
    vi.spyOn(process, "cwd").mockImplementation(() => {
      throw new Error("ENOENT: uv_cwd");
    });
    loadDotEnv();

    expect(process.env.FOO).toBe("from-global");
  });

  it("loads the Ubuntu gateway.env compatibility fallback after ~/.omnipolymath/.env", async () => {
    setTestEnvValue("HOME", fixture.base);
    const defaultStateDir = path.join(fixture.base, ".omnipolymath");
    setTestEnvValue("OMNIPOLYMATH_STATE_DIR", defaultStateDir);
    await writeEnvFile(path.join(defaultStateDir, ".env"), "FOO=from-global\n");
    await writeEnvFile(
      path.join(fixture.base, ".config", "omnipolymath", "gateway.env"),
      ["FOO=from-gateway", "BAR=from-gateway"].join("\n"),
    );

    loggerMocks.warn.mockClear();

    loadDotEnv();

    expect(process.env).toMatchObject({ FOO: "from-global", BAR: "from-gateway" });
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.stringContaining("Conflicting values in"),
      expect.objectContaining({ ignoredPath: expect.stringContaining("gateway.env") }),
    );
  });

  it.each([
    ["credential and gateway auth", CREDENTIAL_AND_GATEWAY_ENV_KEYS],
    ["Windows shell trust-root", WINDOWS_SHELL_TRUST_ROOT_ENV_KEYS],
    [
      "path-override",
      "NPM_CONFIG_PREFIX OMNIPOLYMATH_AGENT_DIR OMNIPOLYMATH_BUNDLED_PLUGINS_DIR OMNIPOLYMATH_OAUTH_DIR PI_CODING_AGENT_DIR PNPM_HOME".split(
        " ",
      ),
    ],
    ["lowercase npm_execpath", ["npm_execpath"]],
  ] as const)("blocks %s vars from workspace .env", async (_name, keys) => {
    await expectBlockedWorkspaceEnv(keys.map((key) => `${key}=./evil-${key}`));
  });

  it("still allows trusted global .env to set non-workspace runtime vars", async () => {
    const trusted = {
      ANTHROPIC_BASE_URL: "https://trusted.example.com/v1",
      HTTP_PROXY: "http://proxy.test:8080",
      OMNIPOLYMATH_PINNED_PYTHON: "/trusted/python",
      OMNIPOLYMATH_PINNED_WRITE_PYTHON: "/trusted/write-python",
      SLACK_API_URL: "http://trusted-slack.example.com/api/",
      ZALO_API_URL: "http://trusted-zalo.example.com/",
    };
    await writeState(envContents(trusted));
    clearEnv(Object.keys(trusted));
    loadDotEnv();
    expect(process.env).toMatchObject(trusted);
  });
});

describe("loadCliDotEnv", () => {
  it("blocks OMNIPOLYMATH_STATE_DIR from workspace .env even when unset in process env", async () => {
    await writeWorkspace("OMNIPOLYMATH_STATE_DIR=./evil-state\n");

    // Exercise the blocklist rather than the already-set skip.
    deleteTestEnvValue("OMNIPOLYMATH_STATE_DIR");
    loadCliDotEnv();

    expect(process.env.OMNIPOLYMATH_STATE_DIR).toBeUndefined();
  });

  it("blocks workspace .env takeover vars before loading the global fallback", async () => {
    const blocked = {
      OMNIPOLYMATH_CONFIG_PATH: "./evil-config.json",
      OMNIPOLYMATH_BUNDLED_PLUGINS_DIR: path.join(fixture.base, "attacker-bundled"),
      OMNIPOLYMATH_BROWSER_CONTROL_MODULE: "data:text/javascript,boom",
      OMNIPOLYMATH_BUNDLED_HOOKS_DIR: "./attacker-hooks",
      OMNIPOLYMATH_BUNDLED_SKILLS_DIR: "./attacker-skills",
      OMNIPOLYMATH_SKIP_BROWSER_CONTROL_SERVER: "1",
      NODE_OPTIONS: "--require ./evil.js",
      NODE_REDIRECT_WARNINGS: "./warnings.log",
      NODE_REPL_EXTERNAL_MODULE: "./evil-repl.js",
      NODE_REPL_HISTORY: "./repl-history",
      NODE_V8_COVERAGE: "./coverage",
      ANTHROPIC_BASE_URL: "https://evil.example.com/v1",
      UV_PYTHON: "./attacker-python",
      uv_python: "./attacker-python-lower",
    };
    await writeWorkspace(
      envContents({ SAFE_KEY: "from-cwd", OMNIPOLYMATH_STATE_DIR: "./evil-state", ...blocked }),
    );
    await writeState("BAR=from-global\n");
    clearEnv(["SAFE_KEY", "BAR", ...Object.keys(blocked)]);

    loadCliDotEnv();

    expect(process.env).toMatchObject({
      SAFE_KEY: "from-cwd",
      BAR: "from-global",
      OMNIPOLYMATH_STATE_DIR: fixture.stateDir,
    });
    expectEnvUndefined(Object.keys(blocked));
  });
});
