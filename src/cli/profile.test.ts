import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

function inheritedEnv(profile = "main", overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const stateDir = `/home/peter/.omnipolymath${profile === "default" ? "" : `-${profile}`}`;
  return {
    OMNIPOLYMATH_PROFILE: profile,
    OMNIPOLYMATH_STATE_DIR: stateDir,
    OMNIPOLYMATH_CONFIG_PATH: path.join(stateDir, "omnipolymath.json"),
    ...overrides,
  };
}

function selectProfile(env: NodeJS.ProcessEnv, profile = "work") {
  applyCliProfileEnv({ profile, env, homedir: () => "/home/peter" });
}

const selectorKeys = [
  "OMNIPOLYMATH_LAUNCHD_LABEL",
  "OMNIPOLYMATH_SYSTEMD_UNIT",
  "OMNIPOLYMATH_WINDOWS_TASK_NAME",
];
const gatewaySelectors = ["ai.omnipolymath.main", "omnipolymath-gateway-main", "Omnipolymath Gateway (main)"];
const nodeSelectors = ["ai.omnipolymath.node", "omnipolymath-node.service", "Omnipolymath Node"];

function serviceEnv(selectors: string[], kind?: string, port?: string) {
  return inheritedEnv("main", {
    ...Object.fromEntries(selectorKeys.map((key, i) => [key, selectors[i]])),
    ...(kind ? { OMNIPOLYMATH_SERVICE_MARKER: "omnipolymath", OMNIPOLYMATH_SERVICE_KIND: kind } : {}),
    ...(port ? { OMNIPOLYMATH_GATEWAY_PORT: port } : {}),
  });
}

describe("parseCliProfileArgs", () => {
  const argv = (args: string) => ["node", "omnipolymath", ...args.split(" ")];
  it.each<[string, string | null, string?]>([
    ["--no-color gateway --dev --allow-unconfigured", null],
    ["qa matrix --profile fast --fail-fast", null],
    ["qa run --profile=release --output qa-report.md", "release", "qa run --output qa-report.md"],
  ])(
    "selects the root profile without consuming command-local flags: %j",
    (args, profile, remaining = args) => {
      expect(parseCliProfileArgs(argv(args))).toEqual({
        ok: true,
        profile,
        argv: argv(remaining),
      });
    },
  );

  it.each(["--profile", "--dev --profile work status", "--profile work --dev status"])(
    "rejects invalid profile options: %s",
    (args) => {
      expect(parseCliProfileArgs(argv(args)).ok).toBe(false);
    },
  );
});

describe("applyCliProfileEnv", () => {
  const workStateDir = path.join(path.resolve("/home/peter"), ".omnipolymath-work");
  it.each<[string, NodeJS.ProcessEnv, string, NodeJS.ProcessEnv]>([
    [
      "explicit paths",
      { OMNIPOLYMATH_PROFILE: "prod", OMNIPOLYMATH_STATE_DIR: "/custom", OMNIPOLYMATH_GATEWAY_PORT: "19099" },
      "dev",
      {
        OMNIPOLYMATH_PROFILE: "dev",
        OMNIPOLYMATH_STATE_DIR: "/custom",
        OMNIPOLYMATH_GATEWAY_PORT: "19099",
        OMNIPOLYMATH_CONFIG_PATH: path.join("/custom", "omnipolymath.json"),
      },
    ],
    [
      "unmarked default profile",
      inheritedEnv("default", { OMNIPOLYMATH_PROFILE: undefined }),
      "work",
      inheritedEnv("work", {
        OMNIPOLYMATH_STATE_DIR: workStateDir,
        OMNIPOLYMATH_CONFIG_PATH: path.join(workStateDir, "omnipolymath.json"),
      }),
    ],
    ["case-distinct profile", inheritedEnv("Main"), "main", inheritedEnv("main")],
  ])("switches %s without leaking another profile's paths", (_name, env, profile, expected) => {
    selectProfile(env, profile);
    expect(env).toEqual(expected);
  });

  it.each([
    ["gateway", "dev", "19001", undefined],
    ["node", "work", "19999", nodeSelectors],
    [undefined, "work", undefined, undefined],
  ] as const)("isolates profiles from %s service selectors", (kind, profile, port, selectors) => {
    const env = serviceEnv(
      kind === "node" ? nodeSelectors : gatewaySelectors,
      kind,
      kind === "node" ? "19999" : kind === "gateway" ? "18789" : undefined,
    );
    if (kind === "gateway") {
      env.OMNIPOLYMATH_SYSTEMD_UNIT += ".service";
    }
    selectProfile(env, profile);
    expect(selectorKeys.map((key) => env[key])).toEqual(
      selectors ?? [undefined, undefined, undefined],
    );
    expect(env.OMNIPOLYMATH_GATEWAY_PORT).toBe(port);
    if (kind === "gateway") {
      expect(env).toMatchObject({
        OMNIPOLYMATH_PROFILE: "dev",
        OMNIPOLYMATH_STATE_DIR: "/home/peter/.omnipolymath-dev",
      });
      expect(env.OMNIPOLYMATH_CONFIG_PATH).toBeUndefined();
    }
  });
});

describe("formatCliCommand", () => {
  it.each<[string, NodeJS.ProcessEnv, string?]>([
    ["omnipolymath doctor --fix", { OMNIPOLYMATH_PROFILE: "Default" }],
    ["omnipolymath doctor --fix", { OMNIPOLYMATH_PROFILE: "bad profile" }],
    ["omnipolymath --dev doctor", { OMNIPOLYMATH_PROFILE: "dev" }],
    [
      "omnipolymath doctor --fix",
      { OMNIPOLYMATH_PROFILE: "  jbomnipolymath  " },
      "omnipolymath --profile jbomnipolymath doctor --fix",
    ],
    ["omnipolymath gateway status --deep", { OMNIPOLYMATH_CONTAINER_HINT: "demo; rm -rf /" }],
    ["npx omnipolymath@2026.10.1 gateway status", { OMNIPOLYMATH_CONTAINER_HINT: "demo" }],
    ["omnipolymath@2026.10.1 doctor --fix", { OMNIPOLYMATH_PROFILE: "work" }],
    ["omnipolymath-2026.10.1 status", { OMNIPOLYMATH_CONTAINER_HINT: "demo" }],
    ["omnipolymath-update --help", { OMNIPOLYMATH_PROFILE: "work" }],
    ["bunx omnipolymath@latest doctor", { OMNIPOLYMATH_CONTAINER_HINT: "demo" }],
    ["pnpm omnipolymath@latest doctor", { OMNIPOLYMATH_PROFILE: "work" }],
    [
      "pnpm omnipolymath plugins update telegram",
      { OMNIPOLYMATH_CONTAINER_HINT: "demo", OMNIPOLYMATH_PROFILE: "work" },
      "pnpm omnipolymath --container demo plugins update telegram",
    ],
  ])("formats %s with %j", (cmd, env, expected = cmd) => {
    expect(formatCliCommand(cmd, env)).toBe(expected);
  });
});
