import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { resolvePreferredOmnipolymathTmpDir } from "../../src/infra/tmp-omnipolymath-dir.js";
import { createSuiteTempRootTracker } from "../../src/test-helpers/temp-dir.js";

const repoRoot = resolve(import.meta.dirname, "../..");

type DockerSetupSandbox = Awaited<ReturnType<typeof createDockerSetupSandbox>>;

const sandboxRootTracker = createSuiteTempRootTracker({
  prefix: "omnipolymath-docker-setup-",
  parentDir: resolvePreferredOmnipolymathTmpDir(),
});

async function writeDockerStub(binDir: string, logPath: string) {
  const stub = `#!/usr/bin/env bash
set -euo pipefail
log="$DOCKER_STUB_LOG"
fail_match="\${DOCKER_STUB_FAIL_MATCH:-}"
docker_host=""
if [[ "\${1:-}" == "--host" ]]; then
  docker_host="\${2:-}"
  shift 2
fi
if [[ "\${1:-}" == "compose" && "\${2:-}" == "version" ]]; then
  exit 0
fi
if [[ "\${1:-}" == "compose" && -n "$fail_match" && "$*" == *"$fail_match"* ]]; then
  echo "$1-fail $*" >>"$log"
  exit 1
fi
if [[ "\${1:-}" == "image" && "\${2:-}" == "inspect" ]]; then
  format=""
  image="\${3:-}"
  if [[ "\${3:-}" == "-f" || "\${3:-}" == "--format" ]]; then
    format="\${4:-}"
    image="\${5:-}"
  fi
  echo "image inspect $image host=$docker_host" >>"$log"
  missing_images=",\${DOCKER_STUB_MISSING_IMAGES:-},"
  [[ "$missing_images" != *",$image,"* ]] || exit 1
  [[ -z "$format" ]] || printf '%s\n' "\${DOCKER_STUB_BROWSER_CONTRACT:-<no value>}"
  exit 0
fi
if [[ "\${1:-}" == "pull" ]]; then
  echo "pull $*" >>"$log"
  exit 0
fi
if [[ "\${1:-}" == "build" ]]; then
  echo "build DOCKER_BUILDKIT=\${DOCKER_BUILDKIT:-} $*" >>"$log"
  exit 0
fi
if [[ "\${1:-}" == "run" ]]; then
  echo "run $*" >>"$log"
  args=("$@")
  for ((i = 0; i + 3 < \${#args[@]}; i++)); do
    [[ "\${args[$i]}" == "--entrypoint" && "\${args[$((i + 1))]}" == "node" ]] || continue
    for ((j = i + 2; j + 1 < \${#args[@]}; j++)); do
      [[ "\${args[$j]}" == "-e" ]] || continue
      exec node -e "\${args[$((j + 1))]}" "\${args[@]:$((j + 2))}"
    done
  done
  exit 0
fi
if [[ "\${1:-}" == "compose" ]]; then
  echo "compose $*" >>"$log"
  empty_json='{}'
  case "$*" in
    *"config get gateway.controlUi.allowedOrigins"*) printf '%s\n' "\${DOCKER_STUB_CONTROL_UI_ORIGINS:-}"; exit 0 ;;
    *"config get gateway.publicOrigin"*) printf '%s\n' "\${DOCKER_STUB_PUBLIC_ORIGIN:-}"; exit 0 ;;
    *"config get tools.sandbox.tools --json"*) printf '%s\n' "\${DOCKER_STUB_SANDBOX_TOOLS_JSON:-$empty_json}"; exit 0 ;;
    *"config get agents --json"*) printf '%s\n' "\${DOCKER_STUB_AGENTS_JSON:-$empty_json}"; exit 0 ;;
  esac
  args=("$@")
  for ((i = 0; i + 4 < \${#args[@]}; i++)); do
    [[ "\${args[$i]}" == "--entrypoint" &&
      "\${args[$((i + 1))]}" == "node" &&
      "\${args[$((i + 2))]}" == "omnipolymath-gateway" &&
      "\${args[$((i + 3))]}" == "-e" ]] || continue
    exec node -e "\${args[$((i + 4))]}" "\${args[@]:$((i + 5))}"
  done
  exit 0
fi
echo "unknown $*" >>"$log"
exit 0
`;

  const timeoutStub = `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == --kill-after=* ]]; then
  shift
elif [[ "\${1:-}" == "--kill-after" ]]; then
  shift 2
fi
if [[ $# -gt 0 ]]; then
  shift
fi
exec "$@"
`;

  await mkdir(binDir, { recursive: true });
  await writeFile(join(binDir, "docker"), stub, { mode: 0o755 });
  await writeFile(join(binDir, "timeout"), timeoutStub, { mode: 0o755 });
  await writeFile(logPath, "");
}

async function expectMissingPath(path: string): Promise<void> {
  await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
}

async function createDockerSetupSandbox() {
  const rootDir = await sandboxRootTracker.make("suite");
  const scriptPath = join(rootDir, "scripts", "docker", "setup.sh");
  const binDir = join(rootDir, "bin");
  const logPath = join(rootDir, "docker-stub.log");

  await mkdir(join(rootDir, "scripts", "docker"), { recursive: true });
  await mkdir(join(rootDir, "scripts", "lib"), { recursive: true });
  await copyFile(join(repoRoot, "scripts", "docker", "setup.sh"), scriptPath);
  for (const file of [
    "docker-build.sh",
    "build-metadata.sh",
    "docker-e2e-logs.sh",
    "docker-e2e-container.sh",
    "docker-e2e-watchdog.mjs",
    "direct-run.mjs",
    "docker-e2e-resource-diagnostics.sh",
    "host-timeout.sh",
  ]) {
    await copyFile(join(repoRoot, "scripts", "lib", file), join(rootDir, "scripts", "lib", file));
  }
  await writeFile(join(rootDir, "Dockerfile"), "FROM scratch\n");
  await writeFile(
    join(rootDir, "docker-compose.yml"),
    "services:\n  omnipolymath-gateway:\n    image: noop\n  omnipolymath-cli:\n    image: noop\n",
  );
  await writeDockerStub(binDir, logPath);

  return { rootDir, scriptPath, logPath, binDir };
}

const prestartContainerEnvFlags = [
  "-e HOME=/home/node",
  "-e OMNIPOLYMATH_HOME=/home/node",
  "-e OMNIPOLYMATH_STATE_DIR=/home/node/.omnipolymath",
  "-e OMNIPOLYMATH_CONFIG_PATH=/home/node/.omnipolymath/omnipolymath.json",
  "-e OMNIPOLYMATH_CONFIG_DIR=/home/node/.omnipolymath",
  "-e OMNIPOLYMATH_WORKSPACE_DIR=/home/node/.omnipolymath/workspace",
].join(" ");

const noFollowOwnershipRepair = (root: string) =>
  `/usr/bin/find -P ${root} -xdev -execdir /usr/bin/chown -h node:node {} +`;
const prestartSafePath = "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

const resetDockerLog = (sandbox: DockerSetupSandbox) => writeFile(sandbox.logPath, "");
const readDockerLog = (sandbox: DockerSetupSandbox) => readFile(sandbox.logPath, "utf8");
const isGatewayStartLine = (line: string) =>
  line.includes("compose") && line.includes(" up -d") && line.includes("omnipolymath-gateway");

function expectOfflineComposePolicy(lines: string[], options: { gatewayStarts?: boolean } = {}) {
  const composeLines = lines.filter((line) => line.startsWith("compose "));
  expect(composeLines.length).toBeGreaterThan(0);
  for (const line of composeLines) {
    if (line.includes(" run ")) {
      expect(line).toContain(" run --pull never ");
    }
  }
  const gatewayStarts = composeLines.filter(isGatewayStartLine);
  expect(gatewayStarts.length > 0).toBe(options.gatewayStarts !== false);
  for (const line of gatewayStarts) {
    expect(line).toContain(" up -d --pull never --no-build");
  }
}

async function withUnixSocket<T>(socketPath: string, run: () => Promise<T>): Promise<T> {
  const server = createServer();
  const listening = once(server, "listening");
  server.listen(socketPath);
  await listening;

  try {
    return await run();
  } finally {
    await new Promise<void>((resolveLocal) => {
      server.close(() => resolveLocal());
    });
    await rm(socketPath, { force: true });
  }
}

function runDockerSetup(
  sandbox: DockerSetupSandbox,
  overrides: Record<string, string | undefined> = {},
  args: string[] = [],
) {
  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.rootDir,
    env: {
      PATH: `${sandbox.binDir}:${process.env.PATH ?? ""}`,
      HOME: process.env.HOME ?? sandbox.rootDir,
      LANG: process.env.LANG,
      LC_ALL: process.env.LC_ALL,
      TMPDIR: process.env.TMPDIR,
      DOCKER_STUB_LOG: sandbox.logPath,
      OMNIPOLYMATH_GATEWAY_TOKEN: "test-token",
      OMNIPOLYMATH_CONFIG_DIR: join(sandbox.rootDir, "config"),
      OMNIPOLYMATH_WORKSPACE_DIR: join(sandbox.rootDir, "omnipolymath"),
      OMNIPOLYMATH_AUTH_PROFILE_SECRET_DIR: join(sandbox.rootDir, "auth-profile-secrets"),
      ...overrides,
    },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("scripts/docker/setup.sh", () => {
  let sandbox: DockerSetupSandbox;
  const path = (...parts: string[]) => join(sandbox.rootDir, ...parts);
  const read = (name: string) => readFile(path(name), "utf8");
  const dockerImage = (image: string) => ({ docker: { image } });
  const browserSettings = (image: string) => ({ browser: { enabled: true, image } });
  const sandboxEntry = (value: object) => ({ sandbox: value });

  async function runLoggedSetup(
    overrides: Record<string, string | undefined> = {},
    args: string[] = [],
  ) {
    await resetDockerLog(sandbox);
    const result = runDockerSetup(sandbox, overrides, args);
    const log = await readDockerLog(sandbox);
    return { result, log, lines: log.split("\n").filter(Boolean) };
  }

  async function runSandbox(overrides: Record<string, string | undefined>, offline = false) {
    const socketPath = path("docker.sock");
    return withUnixSocket(socketPath, async () => ({
      ...(await runLoggedSetup(
        {
          OMNIPOLYMATH_SANDBOX: "1",
          OMNIPOLYMATH_DOCKER_SOCKET: socketPath,
          ...overrides,
        },
        offline ? ["--offline"] : [],
      )),
      socketPath,
    }));
  }

  beforeAll(async () => {
    await sandboxRootTracker.setup();
    sandbox = await createDockerSetupSandbox();
  });

  afterAll(sandboxRootTracker.cleanup);

  it("configures container-local state, mounts, and build defaults before startup", async () => {
    const buildCommit = "0123456789abcdef0123456789abcdef01234567";

    const result = runDockerSetup(sandbox, {
      GIT_COMMIT: buildCommit,
      OMNIPOLYMATH_INSTALL_BROWSER: "1",
      OMNIPOLYMATH_DOCKER_APT_PACKAGES: "curl wget",
      OMNIPOLYMATH_EXTRA_MOUNTS: undefined,
      OMNIPOLYMATH_HOME_VOLUME: "omnipolymath-home",
      OMNIPOLYMATH_SKIP_ONBOARDING: "0",
      OMNIPOLYMATH_HOME: "/mnt/c/Users/Trevor",
      OMNIPOLYMATH_STATE_DIR: "/mnt/c/Users/Trevor/.omnipolymath",
      OMNIPOLYMATH_CONFIG_PATH: "/mnt/c/Users/Trevor/.omnipolymath/omnipolymath.json",
    });
    expect(result.status).toBe(0);
    const envFile = await read(".env");
    const buildArgs = {
      OMNIPOLYMATH_INSTALL_BROWSER: "1",
      OMNIPOLYMATH_IMAGE_APT_PACKAGES: "curl wget",
      OMNIPOLYMATH_DOCKER_BUILD_NODE_OPTIONS: "--max-old-space-size=8192",
      OMNIPOLYMATH_DOCKER_BUILD_TSDOWN_MAX_OLD_SPACE_MB: "",
      OMNIPOLYMATH_DOCKER_BUILD_SKIP_DTS: "1",
    };
    expect(parseEnv(envFile)).toMatchObject({
      ...buildArgs,
      OMNIPOLYMATH_EXTRA_MOUNTS: "",
      OMNIPOLYMATH_HOME_VOLUME: "omnipolymath-home", // pragma: allowlist secret
      OMNIPOLYMATH_DISABLE_BONJOUR: "",
      OMNIPOLYMATH_SKIP_ONBOARDING: "",
      OMNIPOLYMATH_AUTH_PROFILE_SECRET_DIR: join(sandbox.rootDir, "auth-profile-secrets"),
    });
    expect(envFile).not.toContain("OMNIPOLYMATH_DOCKER_APT_PACKAGES");
    const extraCompose = await read("docker-compose.extra.yml");
    expect(extraCompose).toContain("omnipolymath-home:/home/node");
    expect(extraCompose).toContain(`${path("auth-profile-secrets")}:/home/node/.config/omnipolymath`);
    expect(extraCompose).toContain("volumes:");
    expect(extraCompose).toContain("omnipolymath-home:");
    const log = await readDockerLog(sandbox);
    expect(log).not.toContain("--build-arg OMNIPOLYMATH_DOCKER_APT_PACKAGES");
    for (const [key, value] of Object.entries(buildArgs)) {
      expect(log).toContain(`--build-arg ${key}=${value}`);
    }
    expect(log).toMatch(
      /--build-arg OMNIPOLYMATH_BUILD_TIMESTAMP=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/u,
    );
    expect(log).toContain(`--build-arg GIT_COMMIT=${buildCommit}`);
    const lines = log.split("\n");
    const gatewayStartIdx = lines.findIndex(isGatewayStartLine);
    expect(gatewayStartIdx).toBeGreaterThanOrEqual(0);
    const prestartLines = lines.slice(0, gatewayStartIdx);
    expect(
      prestartLines.filter((line) => /\bcompose\b.*\brun\b.*\bomnipolymath-cli\b/.test(line)),
    ).toEqual([]);
    const configLines = prestartLines.filter((line) => line.includes(" dist/index.js config "));
    expect(configLines.length).toBeGreaterThan(0);
    for (const line of configLines) {
      expect(line).toContain(prestartContainerEnvFlags);
      expect(line).not.toContain("/mnt/c");
    }
    expect(log).toContain(
      `run --rm --no-deps ${prestartContainerEnvFlags} --entrypoint node omnipolymath-gateway dist/index.js onboard --mode local --no-install-daemon --gateway-auth token --gateway-token-ref-env OMNIPOLYMATH_GATEWAY_TOKEN --skip-ui --suppress-gateway-token-output`,
    );
    expect(log).toContain(
      `run --rm --no-deps ${prestartContainerEnvFlags} --entrypoint node omnipolymath-gateway dist/index.js config set --batch-json [{"path":"gateway.mode","value":"local"},{"path":"gateway.bind","value":"lan"},{"path":"gateway.controlUi.allowedOrigins","value":["http://localhost:18789","http://127.0.0.1:18789"]}]`,
    );
    expect(result.stdout).toContain(
      `exec omnipolymath-gateway sh -lc 'node dist/index.js gateway health --token "$OMNIPOLYMATH_GATEWAY_TOKEN"'`,
    );
    expect(result.stdout).not.toContain("node dist/index.js health --token");
    expect(result.stdout).not.toContain("test-token");
    expect(result.stdout).not.toContain("#token=");
  });

  it.each([undefined, "[]"])("preserves inherited origins (%j)", async (allowedOrigins) => {
    const { result, lines } = await runLoggedSetup({
      DOCKER_STUB_CONTROL_UI_ORIGINS: allowedOrigins,
      DOCKER_STUB_PUBLIC_ORIGIN: "https://team.example.com",
    });
    expect(result.status).toBe(0);
    const writes = lines.filter((line) => line.includes("config set --batch-json"));
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toContain("https://team.example.com");
    if (allowedOrigins === undefined) {
      expect(writes[0]).not.toContain("gateway.controlUi.allowedOrigins");
    } else {
      expect(writes[0]).toContain(
        '"gateway.controlUi.allowedOrigins","value":["http://localhost:18789","http://127.0.0.1:18789"]',
      );
    }
  });

  it("allows ordinary spaces in host persistence paths and quotes generated mounts", async () => {
    await resetDockerLog(sandbox);
    const mounts = {
      OMNIPOLYMATH_CONFIG_DIR: [path("config with spaces"), "/home/node/.omnipolymath"],
      OMNIPOLYMATH_WORKSPACE_DIR: [path("workspace with spaces"), "/home/node/.omnipolymath/workspace"],
      OMNIPOLYMATH_AUTH_PROFILE_SECRET_DIR: [
        path("auth secrets with spaces"),
        "/home/node/.config/omnipolymath",
      ],
      OMNIPOLYMATH_HOME_VOLUME: [path("home volume with spaces"), "/home/node"],
    };
    const overrides = Object.fromEntries(
      Object.entries(mounts).map(([key, [source]]) => [key, source]),
    );
    const result = runDockerSetup(sandbox, {
      ...overrides,
      OMNIPOLYMATH_EXTRA_MOUNTS: `${path("extra data")}:/mnt/extra data:ro`,
    });
    expect(result.status).toBe(0);
    expect((await stat(path("config with spaces/identity"))).isDirectory()).toBe(true);
    expect(parseEnv(await read(".env"))).toMatchObject(overrides);
    const extraCompose = await read("docker-compose.extra.yml");
    for (const [source, target] of Object.values(mounts)) {
      expect(extraCompose).toContain(`"${source}:${target}"`);
    }
    expect(extraCompose).toContain(`"${path("extra data")}:/mnt/extra data:ro"`);
  });

  it.each([
    { OMNIPOLYMATH_DISABLE_BONJOUR: "0" },
    { OMNIPOLYMATH_TZ: "Asia/Shanghai" },
    {
      OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/protobuf",
      OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: "http/protobuf",
      OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: "http/protobuf",
    },
  ])("persists Docker environment overrides %j", async (overrides) => {
    const result = runDockerSetup(sandbox, overrides);
    expect(result.status).toBe(0);
    const envFile = await read(".env");
    for (const [key, value] of Object.entries(overrides)) {
      expect(envFile).toContain(`${key}=${value}`);
    }
  });

  it.each(["curl wget httpie", ""])("prefers explicit apt packages %j", async (packages) => {
    const { result, log } = await runLoggedSetup({
      OMNIPOLYMATH_IMAGE_APT_PACKAGES: packages,
      OMNIPOLYMATH_DOCKER_APT_PACKAGES: "curl wget",
    });
    expect(result.status).toBe(0);
    const envFile = await read(".env");
    expect(envFile).toContain(`OMNIPOLYMATH_IMAGE_APT_PACKAGES=${packages}`);
    expect(envFile).not.toContain("OMNIPOLYMATH_DOCKER_APT_PACKAGES");
    expect(log).toContain(`--build-arg OMNIPOLYMATH_IMAGE_APT_PACKAGES=${packages}`);
    expect(log).not.toMatch(/--build-arg OMNIPOLYMATH_IMAGE_APT_PACKAGES=curl wget(?! httpie)/);
  });

  it.each([false, true])("requires preloaded images offline (missing=%s)", async (missing) => {
    const image = `ghcr.io/openclaw/openclaw:${missing ? "offline" : "latest"}`;
    const { result, log, lines } = await runLoggedSetup(
      {
        OMNIPOLYMATH_IMAGE: image,
        OMNIPOLYMATH_SKIP_ONBOARDING: missing ? undefined : "1",
        DOCKER_STUB_MISSING_IMAGES: missing ? image : undefined,
      },
      ["--offline"],
    );
    expect(log).toContain(`image inspect ${image}`);
    expect(log).not.toMatch(/^build /m);
    expect(log).not.toMatch(/^pull /m);
    if (missing) {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`Offline Docker setup requires preloaded image ${image}`);
      expect(log).not.toContain("up -d omnipolymath-gateway");
    } else {
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`Using preloaded Docker image: ${image}`);
      expect(log).toContain(
        'config set --batch-json [{"path":"gateway.mode","value":"local"},{"path":"gateway.bind","value":"lan"}',
      );
      expect(log).not.toContain("onboard");
      expect(parseEnv(await read(".env"))).toMatchObject({ OMNIPOLYMATH_SKIP_ONBOARDING: "1" });
      expectOfflineComposePolicy(lines);
    }
  });

  it.each(["missing", "incompatible-browser"])(
    "rejects %s sandbox images offline",
    async (failure) => {
      const defaultImage = "registry.example/omnipolymath-sandbox:approved";
      const agentImage = " registry.example/omnipolymath-sandbox:agent ";
      const browserImage = "registry.example/omnipolymath-sandbox-browser:stale";
      const missing = failure === "missing";
      const { result, log, lines, socketPath } = await runSandbox(
        {
          OMNIPOLYMATH_SKIP_ONBOARDING: "1",
          DOCKER_STUB_AGENTS_JSON: JSON.stringify(
            missing
              ? {
                  defaults: sandboxEntry(dockerImage(defaultImage)),
                  entries: { custom: sandboxEntry(dockerImage(agentImage)) },
                }
              : { defaults: sandboxEntry(browserSettings(browserImage)) },
          ),
          ...(missing
            ? { DOCKER_STUB_MISSING_IMAGES: agentImage }
            : {
                DOCKER_STUB_SANDBOX_TOOLS_JSON: JSON.stringify({ alsoAllow: ["browser"] }),
                DOCKER_STUB_BROWSER_CONTRACT: "old-contract",
              }),
        },
        true,
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "Offline sandbox prerequisites are incomplete; sandbox configuration was not changed",
      );
      expect(log).not.toMatch(/config set agents\.defaults\.sandbox\./);
      expectOfflineComposePolicy(lines, { gatewayStarts: false });
      if (missing) {
        expect(result.stderr).toContain(agentImage);
        expect(log).not.toContain(`image inspect ${defaultImage}`);
        expect(log).toContain(`image inspect ${agentImage} host=unix://${socketPath}`);
        expect(log).not.toContain("image inspect omnipolymath-sandbox:trixie-slim");
        expect(log).not.toMatch(/^build /m);
        expect(log).not.toMatch(/^pull /m);
      } else {
        expect(result.stderr).toContain(
          `${browserImage} (browser contract=old-contract, expected=2026-05-12-cdp-relay-auth)`,
        );
        expect(log).toContain(`image inspect ${browserImage} host=unix://${socketPath}`);
      }
    },
  );

  it("offline sandbox validates only effective Docker and browser images", async () => {
    const defaultImage = "example.test/sandbox:default";
    const browserImage = "example.test/browser:default";
    const ignoredImages = [
      "example.test/sandbox:ssh",
      "example.test/sandbox:shared",
      "example.test/browser:shared",
      "example.test/sandbox:off",
      "example.test/browser:denied",
    ] as const;
    const { result, log, lines, socketPath } = await runSandbox(
      {
        OMNIPOLYMATH_SKIP_ONBOARDING: "1",
        DOCKER_STUB_AGENTS_JSON: JSON.stringify({
          defaults: sandboxEntry({
            backend: "Docker",
            ...dockerImage(defaultImage),
            ...browserSettings(browserImage),
          }),
          entries: {
            ssh: sandboxEntry({ backend: "ssh", ...dockerImage(ignoredImages[0]) }),
            shared: sandboxEntry({
              scope: "shared",
              ...dockerImage(ignoredImages[1]),
              browser: { image: ignoredImages[2] },
            }),
            off: sandboxEntry({ mode: "off", ...dockerImage(ignoredImages[3]) }),
            "browser-denied": {
              ...sandboxEntry(browserSettings(ignoredImages[4])),
              tools: { sandbox: { tools: { deny: ["browser"] } } },
            },
          },
        }),
        DOCKER_STUB_SANDBOX_TOOLS_JSON: JSON.stringify({ alsoAllow: ["group:ui"] }),
        DOCKER_STUB_BROWSER_CONTRACT: "2026-05-12-cdp-relay-auth",
        DOCKER_STUB_MISSING_IMAGES: ignoredImages.join(","),
      },
      true,
    );

    expect(result.status, result.stderr).toBe(0);
    for (const image of [defaultImage, browserImage]) {
      expect(result.stdout).toContain(`  - ${image}`);
      expect(log).toContain(`image inspect ${image} host=unix://${socketPath}`);
    }
    for (const image of ignoredImages) {
      expect(log).not.toContain(`image inspect ${image}`);
    }
    expect(log).toContain("config set agents.defaults.sandbox.mode non-main");
    expectOfflineComposePolicy(lines);
  });

  it("precreates writable state and separate secret directories without traversing workspace data", async () => {
    const configDir = path("config-agent-dirs");
    const workspaceDir = join(configDir, "workspace");
    const secretDir = path("auth-profile-secret-key");
    const stateFiles = [
      "identity/owned.txt",
      "agents/workspace/owned.txt",
      "workspace-archive/owned.txt",
    ];
    const workspaceFile = "workspace/project/user.txt";
    for (const relative of [...stateFiles, workspaceFile]) {
      const filePath = join(configDir, relative);
      await mkdir(join(filePath, ".."), { recursive: true });
      await writeFile(filePath, "fixture");
    }
    expect((await stat(workspaceDir)).dev).toBe((await stat(configDir)).dev);

    const result = runDockerSetup(sandbox, {
      OMNIPOLYMATH_CONFIG_DIR: configDir,
      OMNIPOLYMATH_WORKSPACE_DIR: workspaceDir,
      OMNIPOLYMATH_AUTH_PROFILE_SECRET_DIR: secretDir,
    });

    expect(result.status).toBe(0);
    expect((await stat(secretDir)).isDirectory()).toBe(true);
    expect(secretDir.startsWith(`${configDir}/`)).toBe(false);
    for (const name of ["agent", "sessions"]) {
      expect((await stat(join(configDir, "agents/main", name))).isDirectory()).toBe(true);
    }
    const log = await readDockerLog(sandbox);
    const stateRepair = log.match(/\/usr\/bin\/find -P \/home\/node\/\.omnipolymath [^;]+/u)?.[0];
    if (!stateRepair) {
      throw new Error("Missing generated state ownership repair");
    }
    expect(log).toContain(
      `--user root --entrypoint sh omnipolymath-gateway -c ${prestartSafePath}; export PATH`,
    );
    expect(log.indexOf(stateRepair)).toBeLessThan(log.indexOf("onboard"));
    expect(log).toContain("/usr/bin/chown -h node:node /home/node/.config");
    expect(log).toContain(noFollowOwnershipRepair("/home/node/.config/omnipolymath"));
    expect(log).toContain("[ ! -L /home/node/.omnipolymath/workspace/.omnipolymath ]");
    expect(log).toContain(noFollowOwnershipRepair("/home/node/.omnipolymath/workspace/.omnipolymath"));
    expect(stateRepair).toContain("-execdir /usr/bin/chown -h node:node {} +");

    // Execute the generated traversal, replacing only the ownership side effect.
    // Same-device workspace mounts are not excluded by find's -xdev option.
    const selection = stateRepair
      .replaceAll("/home/node/.omnipolymath", '"$repair_root"')
      .replace(/-execdir \/usr\/bin\/chown -h node:node \{\} \+$/u, "-print");
    expect(selection).not.toContain("chown");
    const traversal = spawnSync(
      "bash",
      ["-c", 'repair_root="$(cd "$1" && pwd)"; ' + selection, "ownership-repair", configDir],
      { encoding: "utf8" },
    );
    expect(traversal.status, traversal.stderr).toBe(0);
    const selected = traversal.stdout.trim().split(/\r?\n/u);
    const selectedRoot = selected[0];
    expect(selectedRoot).toMatch(/\/config-agent-dirs$/u);
    for (const relative of stateFiles) {
      expect(selected).toContain(`${selectedRoot}/${relative}`);
    }
    expect(selected).toContain(`${selectedRoot}/workspace`);
    expect(selected).not.toContain(`${selectedRoot}/${workspaceFile}`);
  });

  it.each(["config", "dotenv"])("reuses the %s token", async (source) => {
    const configDir = path(`config-${source}`);
    await mkdir(configDir, { recursive: true });
    if (source === "dotenv") {
      await writeFile(
        path(".env"),
        [
          "OMNIPOLYMATH_GATEWAY_TOKEN=",
          "OMNIPOLYMATH_GATEWAY_TOKEN=first-token",
          "OMNIPOLYMATH_GATEWAY_TOKEN=last=token=value\r", // pragma: allowlist secret
        ].join("\n"),
      );
    } else {
      await writeFile(
        join(configDir, "omnipolymath.json"),
        JSON.stringify({ gateway: { auth: { mode: "token", token: "config-token-123" } } }),
      );
    }
    const result = runDockerSetup(sandbox, {
      OMNIPOLYMATH_GATEWAY_TOKEN: undefined,
      OMNIPOLYMATH_CONFIG_DIR: configDir,
      OMNIPOLYMATH_WORKSPACE_DIR: path(`workspace-${source}`),
    });
    const envFile = await read(".env");
    expect(result.status).toBe(0);
    if (source === "config") {
      expect(envFile).toContain("OMNIPOLYMATH_GATEWAY_TOKEN=config-token-123"); // pragma: allowlist secret
    } else {
      expect(envFile).toContain("OMNIPOLYMATH_GATEWAY_TOKEN=last=token=value"); // pragma: allowlist secret
      expect(envFile).not.toContain("OMNIPOLYMATH_GATEWAY_TOKEN=first-token");
      expect(envFile).not.toContain("\r");
      expect(result.stderr).toBe("");
    }
  });

  it("treats OMNIPOLYMATH_SANDBOX=0 as disabled", async () => {
    const { result, log } = await runLoggedSetup({ OMNIPOLYMATH_SANDBOX: "0" });
    expect(result.status).toBe(0);
    expect(await read(".env")).toContain("OMNIPOLYMATH_SANDBOX=");
    expect(log).toContain("--build-arg OMNIPOLYMATH_INSTALL_DOCKER_CLI=");
    expect(log).not.toContain("--build-arg OMNIPOLYMATH_INSTALL_DOCKER_CLI=1");
    expect(log).toContain("config set agents.defaults.sandbox.mode off");
  });

  it("resets stale sandbox mode and overlay when sandbox is not active", async () => {
    await mkdir(path("scripts/docker/sandbox"), { recursive: true });
    await writeFile(path("scripts/docker/sandbox/Dockerfile"), "FROM scratch\n");
    await writeFile(
      path("docker-compose.sandbox.yml"),
      "services:\n  omnipolymath-gateway:\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n",
    );
    const { result, log } = await runSandbox({
      DOCKER_STUB_FAIL_MATCH: "--entrypoint docker omnipolymath-gateway --version",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Sandbox requires Docker CLI");
    expect(log).toContain("config set agents.defaults.sandbox.mode off");
    await expectMissingPath(path("docker-compose.sandbox.yml"));
  });

  it("keeps offline policy when sandbox config writes fail and the gateway rolls back", async () => {
    const { result, log, lines, socketPath } = await runSandbox(
      { DOCKER_STUB_FAIL_MATCH: "config set agents.defaults.sandbox.scope" },
      true,
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Failed to set agents.defaults.sandbox.scope");
    expect(result.stderr).toContain("Skipping gateway restart to avoid exposing Docker socket");
    expect(lines.filter(isGatewayStartLine)).toHaveLength(2);
    expect(log).toContain(
      "run --pull never --rm --no-deps omnipolymath-cli config set agents.defaults.sandbox.mode non-main",
    );
    expect(log).toContain("config set agents.defaults.sandbox.mode off");
    const forceRecreateLine = lines.find((line) =>
      line.includes("--force-recreate omnipolymath-gateway"),
    );
    expect(forceRecreateLine).toBe(
      `compose compose -f ${path("docker-compose.yml")} up -d --pull never --no-build --force-recreate omnipolymath-gateway`,
    );
    expect(forceRecreateLine).not.toContain("docker-compose.sandbox.yml");
    expect(log).toContain(`image inspect omnipolymath-sandbox:trixie-slim host=unix://${socketPath}`);
    expectOfflineComposePolicy(lines);
    await expectMissingPath(path("docker-compose.sandbox.yml"));
  });

  it.each([
    [
      "OMNIPOLYMATH_EXTRA_MOUNTS",
      "/tmp:/tmp\n  evil-service:\n    image: alpine",
      "OMNIPOLYMATH_EXTRA_MOUNTS cannot contain control characters",
    ],
    ["OMNIPOLYMATH_EXTRA_MOUNTS", "bad mount spec", "Invalid mount format"],
    ["OMNIPOLYMATH_HOME_VOLUME", "bad name", "OMNIPOLYMATH_HOME_VOLUME must match"],
    ["OMNIPOLYMATH_TZ", "Nope/Bad", "OMNIPOLYMATH_TZ must be supported by omnipolymath:local"],
  ])("rejects invalid %s=%j", (key, value, diagnostic) => {
    const result = runDockerSetup(sandbox, { [key]: value });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(diagnostic);
  });

  it("keeps the Compose services aligned with container networking and durable state", async () => {
    const compose = await readFile(join(repoRoot, "docker-compose.yml"), "utf8");
    const { services } = parse(compose) as {
      services: Record<
        "omnipolymath-gateway" | "omnipolymath-cli",
        {
          environment: Record<string, string>;
          command: string[];
          ports: string[];
          volumes: string[];
        }
      >;
    };
    const gateway = services["omnipolymath-gateway"];
    expect(services["omnipolymath-cli"]).toMatchObject({
      network_mode: "service:omnipolymath-gateway",
      depends_on: ["omnipolymath-gateway"],
    });
    const listenerPort = gateway.command[gateway.command.indexOf("--port") + 1];
    expect(listenerPort).toBe("18789");
    expect(gateway.ports).toContain(`\${OMNIPOLYMATH_GATEWAY_PORT:-18789}:${listenerPort}`);
    for (const name of ["omnipolymath-gateway", "omnipolymath-cli"] as const) {
      expect(services[name]).toMatchObject({ env_file: [{ path: ".env", required: false }] });
      expect(
        services[name].volumes.filter(
          (value) =>
            value ===
            "${OMNIPOLYMATH_AUTH_PROFILE_SECRET_DIR:-${HOME:-/tmp}/.omnipolymath-auth-profile-secrets}:/home/node/.config/omnipolymath",
        ),
      ).toHaveLength(1);
      expect(services[name].environment, name).toMatchObject({
        OMNIPOLYMATH_HOME: "/home/node",
        OMNIPOLYMATH_STATE_DIR: "/home/node/.omnipolymath",
        OMNIPOLYMATH_CONFIG_PATH: "/home/node/.omnipolymath/omnipolymath.json",
        OMNIPOLYMATH_CONFIG_DIR: "/home/node/.omnipolymath",
        OMNIPOLYMATH_WORKSPACE_DIR: "/home/node/.omnipolymath/workspace",
        OMNIPOLYMATH_GATEWAY_PORT: listenerPort,
        OMNIPOLYMATH_GATEWAY_TOKEN: "${OMNIPOLYMATH_GATEWAY_TOKEN:-}",
      });
    }
  });

  it("Dockerfile ARG OMNIPOLYMATH_IMAGE_APT_PACKAGES must not have a default value", async () => {
    // A default makes the ARG set, suppressing the legacy build-arg fallback.
    const dockerfile = await readFile(join(repoRoot, "Dockerfile"), "utf8");
    const argLine = dockerfile
      .split("\n")
      .find((line) => line.startsWith("ARG OMNIPOLYMATH_IMAGE_APT_PACKAGES"));
    expect(argLine).toBe("ARG OMNIPOLYMATH_IMAGE_APT_PACKAGES");
  });
});
