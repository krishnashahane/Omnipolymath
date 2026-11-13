import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { quoteCmdScriptArg } from "../daemon/cmd-argv.js";
import {
  buildWindowsCmdExeCommandLine,
  resolveTrustedWindowsCmdExe,
} from "../process/windows-command.js";
import { withEnvAsync } from "../test-utils/env.js";
import { withTempDir } from "../test-utils/temp-dir.js";
import { resolveCurrentOmnipolymathCliInvocation } from "./omnipolymath-cli-invocation.js";
import {
  createSourceCliFixture,
  runSourceCliProbe,
  withSourceCliParent,
} from "./omnipolymath-cli-invocation.test-support.js";
import { clearGatewayAgentCliShim, prepareGatewayAgentCliShim } from "./omnipolymath-cli-shim.js";

async function sourceFixture(root: string) {
  const f = await createSourceCliFixture(root);
  function check(result: ReturnType<typeof runSourceCliProbe>, args: string[], extra = {}) {
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      source: "gateway",
      args,
      cwd: f.callerCwd,
      ...extra,
    });
  }
  return {
    ...f,
    check,
    async shim(env = {}) {
      const stateDir = path.join(root, "state");
      await withEnvAsync({ ...env, OMNIPOLYMATH_STATE_DIR: stateDir }, () =>
        withSourceCliParent(f, prepareGatewayAgentCliShim),
      );
      return path.join(stateDir, "tmp", "agent-cli", "omnipolymath.cmd");
    },
    cmd(file: string, args: string[], expansion = "on") {
      return runSourceCliProbe(
        resolveTrustedWindowsCmdExe(),
        ["/d", `/v:${expansion}`, "/s", "/c", buildWindowsCmdExeCommandLine(file, args)],
        f.callerCwd,
        { windowsVerbatimArguments: true },
      );
    },
  };
}

afterEach(clearGatewayAgentCliShim);
describe.skipIf(process.platform !== "win32")("native Windows source CLI shim", () => {
  it.each(["off", "on"])(
    "preserves source paths and caller cwd with delayed expansion %s",
    (expansion) =>
      withTempDir("omnipolymath-source-cli-win-", async (root) => {
        const f = await sourceFixture(root);
        const args = ["--profile", "work", "probe"];
        const shim = await f.shim({ OMNIPOLYMATH_PROFILE: "work" });
        f.check(
          f.cmd(shim, ["probe"], expansion),
          args,
          process.versions.bun ? {} : { tsconfigPath: path.join(f.checkout, "tsconfig.json") },
        );
      }),
  );

  it("preserves literal forwarded bangs and percent signs", () =>
    withTempDir("omnipolymath-source-cli-args-win-", async (root) => {
      const f = await sourceFixture(root);
      const shim = await f.shim();
      const caller = path.join(root, "caller.cmd");
      // Forward literal arguments from a caller with expansion disabled into an enabled shell.
      await fs.writeFile(
        caller,
        [
          "@echo off",
          "setlocal DisableDelayedExpansion",
          `${quoteCmdScriptArg(shim, { delayedExpansion: false })} probe "literal!%%USERPROFILE%%!"`,
          "",
        ].join("\r\n"),
      );
      f.check(f.cmd(caller, []), ["probe", "literal!%USERPROFILE%!"]);
    }));

  it.each(["generic Node host", "bare TSX source parent"])(
    "launches source mode outside the checkout from a %s",
    (parent) =>
      withTempDir("omnipolymath-source-cli-host-win-", async (root) => {
        const f = await sourceFixture(root);
        const modulesDir = path.join(f.checkout, "node_modules");
        await fs.mkdir(modulesDir);
        await fs.symlink(
          path.dirname(createRequire(import.meta.url).resolve("tsx/package.json")),
          path.join(modulesDir, "tsx"),
          "junction",
        );
        const hostEntry = path.join(f.checkout, "scripts", "host.mjs");
        await fs.mkdir(path.dirname(hostEntry));
        await fs.writeFile(hostEntry, "// A generic Node host is not the Omnipolymath CLI entry.\n");
        const sourceParent = parent === "bare TSX source parent";
        const execArgv = sourceParent ? ["--import", "tsx"] : f.execArgv;
        const invocation = withSourceCliParent(
          {
            entryPath: sourceParent ? f.entryPath : hostEntry,
            execArgv: sourceParent ? execArgv : [],
          },
          () => resolveCurrentOmnipolymathCliInvocation(["probe"]),
        );
        f.check(
          runSourceCliProbe(invocation.command, invocation.args, f.callerCwd, {
            env: invocation.env,
          }),
          ["probe"],
        );
      }),
  );
});
