import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";

const execFileAsync = promisify(execFile);
const script = fileURLToPath(new URL("../../scripts/lib/omnipolymath-test-state.mts", import.meta.url));
const tempDirs = useAutoCleanupTempDirTracker(afterEach);
let root: string;
let snippet: string;
beforeEach(() => {
  root = tempDirs.make("omnipolymath-test-state-");
  snippet = path.join(root, "state.sh");
});

const quote = (value: string) => `'${value.replace(/'/gu, `'\\''`)}'`;

type StateOptions = Record<string, string>;
async function render(command: string, options: StateOptions = {}, preload = false) {
  const args = Object.entries(options).flatMap(([key, value]) => [`--${key}`, value]);
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      ...(preload ? ["--import", "tsx"] : []),
      script,
      ...(command === "create" ? ["--", command, ...args, "--json"] : [command, ...args]),
    ],
    { env: { ...process.env, TMPDIR: root } },
  );
  if (command !== "create") {
    await fs.writeFile(snippet, stdout, "utf8");
  }
  return stdout;
}

async function probe(tmpDir?: string, after = "", login = true) {
  const setup = tmpDir ? `export OMNIPOLYMATH_TEST_STATE_TMPDIR=${quote(tmpDir)};` : "";
  const { stdout } = await execFileAsync("bash", [
    login ? "-lc" : "-c",
    `unset OMNIPOLYMATH_TEST_STATE_HOME; cleanup() { [ -z "\${OMNIPOLYMATH_TEST_STATE_HOME:-}" ] || rm -rf "$OMNIPOLYMATH_TEST_STATE_HOME"; }; trap cleanup EXIT; ${setup} source ${quote(snippet)}; ${after} node -e 'const fs=require("node:fs"); const env=process.env; const config=JSON.parse(fs.readFileSync(env.OMNIPOLYMATH_CONFIG_PATH,"utf8")); process.stdout.write(JSON.stringify({home:env.HOME,stateDir:env.OMNIPOLYMATH_STATE_DIR,workspace:env.OMNIPOLYMATH_TEST_WORKSPACE_DIR,omnipolymathHome:env.OMNIPOLYMATH_HOME,tmpDir:env.OMNIPOLYMATH_TEST_STATE_TMPDIR,tmpRoot:env.OMNIPOLYMATH_TEST_STATE_TMP_ROOT,agentDir:env.OMNIPOLYMATH_AGENT_DIR || null,channel:config.update?.channel,exports:{HOME:env.HOME,USERPROFILE:env.USERPROFILE,OMNIPOLYMATH_HOME:env.OMNIPOLYMATH_HOME,OMNIPOLYMATH_STATE_DIR:env.OMNIPOLYMATH_STATE_DIR,OMNIPOLYMATH_CONFIG_PATH:env.OMNIPOLYMATH_CONFIG_PATH},config}));'`,
  ]);
  return JSON.parse(stdout);
}

describe("scripts/lib/omnipolymath-test-state", () => {
  it("creates a sourceable env file and JSON description", async () => {
    const payload = JSON.parse(
      await render(
        "create",
        { label: "script-test", scenario: "update-stable", "env-file": snippet },
        true,
      ),
    );
    expect(payload.config).toEqual({ update: { channel: "stable" }, plugins: {} });
    const sourced = await probe();
    expect(sourced.exports).toEqual(payload.env);
    expect(sourced).toMatchObject({
      home: payload.home,
      omnipolymathHome: payload.home,
      stateDir: path.join(payload.home, ".omnipolymath"),
      exports: { USERPROFILE: payload.home },
      channel: "stable",
    });
  });

  it("renders a Docker-friendly shell snippet", async () => {
    await render("shell", {
      label: "update-channel-switch",
      scenario: "update-stable",
    });
    const payload = await probe();
    expect(payload.home.startsWith(os.tmpdir())).toBe(true);
    expect(path.basename(payload.home)).toMatch(
      /^omnipolymath-update-channel-switch-update-stable-home\./u,
    );
    expect(payload).toMatchObject({
      omnipolymathHome: payload.home,
      workspace: `${payload.home}/workspace`,
      channel: "stable",
    });
    const customTemp = path.join(root, "state-tmp");
    for (const tmpDir of [customTemp, `${customTemp}/`]) {
      const custom = await probe(tmpDir);
      expect(custom).toMatchObject({
        tmpRoot: customTemp,
      });
      expect(path.dirname(custom.home)).toBe(customTemp);
      expect(path.basename(custom.home)).toMatch(
        /^omnipolymath-update-channel-switch-update-stable-home\./u,
      );
      if (tmpDir.endsWith("/")) {
        expect(custom.stateDir).toBe(`${custom.home}/.omnipolymath`);
      }
    }
  });

  it("creates the upgrade survivor scenario", async () => {
    const payload = JSON.parse(
      await render("create", { label: "upgrade-survivor", scenario: "upgrade-survivor" }),
    );
    expect(payload.config.gateway.reload).toStrictEqual({ mode: "off" });
    expect(payload.config.gateway.auth).toStrictEqual({
      mode: "token",
      token: { id: "GATEWAY_AUTH_TOKEN_REF", provider: "default", source: "env" },
    });
    expect(payload.config.channels.discord.dm).toStrictEqual({
      allowFrom: ["111111111111111111"],
      policy: "allowlist",
    });
    await render("shell-function");
    const shell = await probe(
      undefined,
      `omnipolymath_test_state_create ${quote(path.join(payload.root, "shell-home"))} upgrade-survivor;`,
      false,
    );
    expect(shell.config.gateway).toStrictEqual(payload.config.gateway);
  });

  it("renders a reusable Docker shell function", async () => {
    await render("shell-function", {}, true);
    const temp = path.join(root, "function-tmp");
    for (const tmpDir of [temp, `${temp}/`]) {
      const payload = await probe(
        tmpDir,
        'export OMNIPOLYMATH_AGENT_DIR=/tmp/outside-agent; omnipolymath_test_state_create "onboard case" minimal;',
      );
      expect(payload).toMatchObject({
        home: `${temp}/${path.basename(payload.home)}`,
        stateDir: `${payload.home}/.omnipolymath`,
        workspace: `${payload.home}/workspace`,
        agentDir: null,
      });
      expect(payload.home).toContain("/omnipolymath-onboard-case-minimal-home.");
      expect(payload.config).toStrictEqual({});
    }
    const existingHome = path.join(root, "existing-home");
    const existing = await probe(
      undefined,
      `omnipolymath_test_state_create ${quote(existingHome)} minimal; printf '{"kept":true}\\n' > "$OMNIPOLYMATH_CONFIG_PATH"; omnipolymath_test_state_create ${quote(existingHome)} empty;`,
    );
    expect(existing.home).toBe(existingHome);
    expect(existing.config).toEqual({ kept: true });
  });
});
