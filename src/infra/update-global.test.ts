import fs from "node:fs/promises";
import path from "node:path";
import { bundledDistPluginFile } from "omnipolymath/plugin-sdk/test-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writePackageDistInventory } from "../../scripts/lib/package-dist-inventory.ts";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { quoteCliArg } from "../cli/quote-cli-arg.js";
import { BUNDLED_RUNTIME_SIDECAR_PATHS } from "../plugins/runtime-sidecar-paths.js";
import * as exec from "../process/exec.js";
import { captureEnv } from "../test-utils/env.js";
import { mockProcessPlatform } from "../test-utils/vitest-spies.js";
import { PACKAGE_DIST_INVENTORY_RELATIVE_PATH } from "./package-dist-inventory.js";
import { pkgQueryResult } from "./update-freebsd-pkg-ownership.test-support.js";
import type { CommandRunner } from "./update-global-command-runner.js";
import {
  canResolveRegistryVersionForPackageTarget,
  collectInstalledGlobalPackageErrors,
  cleanupGlobalRenameDirs,
  detectGlobalInstallManagerByPresence,
  detectGlobalInstallManagerForRoot,
  createGlobalInstallEnv,
  globalInstallArgs,
  isPackageTargetAlreadyCurrent,
  resolveExpectedInstalledVersionFromSpec,
  resolveGlobalInstallSpec,
} from "./update-global.js";
import { commandResult, resolveTarget } from "./update-global.test-support.js";
import { resolvePnpmGlobalDirFromGlobalRoot } from "./update-native-package-owner.js";
import {
  resolveNpmGlobalPrefixLayoutFromGlobalRoot,
  resolveNpmGlobalPrefixLayoutFromPrefix,
} from "./update-npm-prefix.js";

const dirs = useAutoCleanupTempDirTracker(afterEach);

async function npmFixture(prefix: string, name = "omnipolymath") {
  const globalRoot = path.join(prefix, "lib/node_modules");
  const pkgRoot = path.join(globalRoot, name);
  await fs.mkdir(pkgRoot, { recursive: true });
  return { globalRoot, pkgRoot };
}

function npmTarget(globalRoot: string, packageRoot: string, version: string | null = "12.0.0") {
  return {
    manager: "npm",
    command: "npm",
    globalRoot,
    packageRoot,
    npmOwner: { version, lifecyclePolicy: version ? "allow-scripts" : null },
  };
}

async function expectPackageError(packageRoot: string, error: string) {
  expect(await collectInstalledGlobalPackageErrors({ packageRoot })).toContain(error);
}

const execFileSyncMock = vi.hoisted(() => vi.fn(() => "/tmp/omnipolymath-test-global-npmrc\n"));
const TELEGRAM_RUNTIME_API = bundledDistPluginFile("telegram", "runtime-api.js");
const expectedNpmInstall =
  "npm i -g --allow-scripts=omnipolymath omnipolymath@latest --no-fund --no-audit --loglevel=error --min-release-age=0".split(
    " ",
  );

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: execFileSyncMock,
  };
});

async function writeGlobalPackageJson(packageRoot: string, version = "1.0.0") {
  await writeFixture(packageRoot, "package.json", JSON.stringify({ name: "omnipolymath", version }));
}

async function writeBundledPluginPackageJson(
  packageRoot: string,
  pluginId: string,
  packageName: string,
) {
  await writeFixture(
    packageRoot,
    `dist/extensions/${pluginId}/package.json`,
    JSON.stringify({ name: packageName }),
  );
}

async function writeFixture(root: string, relative: string, content = "export {};\n") {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

function createNpmRootRunner(defaultNpmRoot: string): CommandRunner {
  return rootRunner({ npm: defaultNpmRoot, pnpm: null }, "12.0.0");
}

function rootRunner(roots: Record<string, string | null>, version?: string): CommandRunner {
  return async (argv) => {
    if (version && argv[1] === "--version") {
      return commandResult(`${version}\n`);
    }
    const command = argv[0];
    if (!command || !(command in roots)) {
      throw new Error(`unexpected command: ${argv.join(" ")}`);
    }
    const root = roots[command];
    return commandResult(root ? `${root}\n` : "", root ? 0 : 1);
  };
}

describe("update global helpers", () => {
  let envSnapshot: ReturnType<typeof captureEnv> | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    execFileSyncMock.mockClear();
    envSnapshot?.restore();
    envSnapshot = undefined;
  });

  it("prefers explicit package spec overrides", () => {
    envSnapshot = captureEnv(["OMNIPOLYMATH_UPDATE_PACKAGE_SPEC"]);
    process.env.OMNIPOLYMATH_UPDATE_PACKAGE_SPEC = "file:/tmp/omnipolymath.tgz";

    expect(resolveGlobalInstallSpec({ packageName: "omnipolymath", tag: "latest" })).toBe(
      "file:/tmp/omnipolymath.tgz",
    );
    expect(
      resolveGlobalInstallSpec({
        packageName: "omnipolymath",
        tag: "beta",
        env: { OMNIPOLYMATH_UPDATE_PACKAGE_SPEC: "omnipolymath@next" },
      }),
    ).toBe("omnipolymath@next");
  });

  it.each([
    ["latest", "omnipolymath@latest"],
    ["github:krishnashahane/Omnipolymath#feature/my-branch", "github:krishnashahane/Omnipolymath#feature/my-branch"],
  ] as const)("maps package target %s to its install spec", (tag, expected) => {
    expect(resolveGlobalInstallSpec({ packageName: "omnipolymath", tag })).toBe(expected);
  });

  it.each([
    { spec: "other@1.2.3", expected: null },
    { spec: "omnipolymath@^1.2.3", expected: null },
    { spec: "omnipolymath@=v1.2.3", expected: "1.2.3" },
  ])("derives an exact installed version from $spec", ({ spec, expected }) => {
    expect(resolveExpectedInstalledVersionFromSpec("omnipolymath", spec)).toBe(expected);
  });

  it("recognizes the installed version of a pinned package target", () => {
    expect(
      isPackageTargetAlreadyCurrent({
        currentVersion: "1.0.0",
        targetVersion: "1.0.0",
        target: "omnipolymath@1.0.0",
      }),
    ).toBe(true);
  });

  it("passes a source package target through without registry resolution", () => {
    expect(canResolveRegistryVersionForPackageTarget("krishnashahane/Omnipolymath#main")).toBe(false);
    expect(
      resolveGlobalInstallSpec({ packageName: "omnipolymath", tag: "krishnashahane/Omnipolymath#main", env: {} }),
    ).toBe("krishnashahane/Omnipolymath#main");
  });

  it("resolves scoped package paths from the package manager global root", async () => {
    const globalRoot = path.join("tmp/npm-root");
    const runCommand: CommandRunner = async () => commandResult(`${globalRoot}\n`);

    await expect(
      resolveTarget(runCommand, undefined, { packageName: "@kevins8/omnipolymath" }),
    ).resolves.toMatchObject({
      manager: "npm",
      globalRoot,
      packageRoot: path.join(globalRoot, "@kevins8/omnipolymath"),
    });
  });

  it.each([
    ["11.15.9", "unflagged"],
    ["11.16.0", "allow-scripts-advisory"],
  ] as const)("binds npm %s lifecycle policy to the owning executable", async (version, policy) => {
    const prefix = dirs.make("omnipolymath-npm-owner-");

    const { globalRoot, pkgRoot: packageRoot } = await npmFixture(prefix);
    const owningNpm = path.join(prefix, "bin/npm");
    await writeFixture(prefix, "bin/npm", "");
    const runCommand: CommandRunner = async (argv) => {
      if (argv[0] === owningNpm && argv[1] === "root") {
        return commandResult(`${globalRoot}\n`);
      }
      if (argv[0] === owningNpm && argv[1] === "--version") {
        return commandResult(`${version}\n`);
      }
      throw new Error(`unexpected command: ${argv.join(" ")}`);
    };

    await expect(
      resolveTarget(runCommand, packageRoot, { packageName: "omnipolymath" }),
    ).resolves.toMatchObject({
      command: owningNpm,
      npmOwner: { version, lifecyclePolicy: policy },
    });
  });

  it("defaults corepack download prompts off for global install env", async () => {
    const defaultEnv = await createGlobalInstallEnv({});
    expect(defaultEnv).toMatchObject({
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
      NPM_CONFIG_BEFORE: "",
      npm_config_before: "",
      "npm_config_min-release-age": "",
      npm_config_min_release_age: "0",
    });

    const explicitEnv = await createGlobalInstallEnv({ COREPACK_ENABLE_DOWNLOAD_PROMPT: "1" });
    expect(explicitEnv?.COREPACK_ENABLE_DOWNLOAD_PROMPT).toBe("1");
  });

  it("probes package-manager roots with the same non-interactive policy", async () => {
    const base = dirs.make("omnipolymath-update-probe-policy-");
    const binDir = path.join(base, "bin");
    const globalRoot = path.join(base, "global", "node_modules");
    const captureFile = path.join(base, "probe.json");
    await fs.mkdir(path.join(globalRoot, "omnipolymath"), { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    // A launcher that needs Corepack's download confirmation exits when the
    // probe does not suppress the prompt, matching the reported stall.
    const probeScript = path.join(base, "corepack-pnpm-probe.cjs");
    await fs.writeFile(
      probeScript,
      `const fs = require("node:fs");
const prompt = process.env.COREPACK_ENABLE_DOWNLOAD_PROMPT ?? null;
fs.writeFileSync(${JSON.stringify(captureFile)}, JSON.stringify({ prompt }));
if (prompt !== "0") {
  console.error("corepack download confirmation cannot be answered");
  process.exit(3);
}
console.log(${JSON.stringify(globalRoot)});
`,
    );
    const executable = process.platform === "win32" ? ".cmd" : "";
    await fs.writeFile(
      path.join(binDir, `pnpm${executable}`),
      process.platform === "win32"
        ? `@echo off\r\n"${process.execPath}" "${probeScript}" %*\r\n`
        : `#!/bin/sh\nexec ${quoteCliArg(process.execPath)} ${quoteCliArg(probeScript)} "$@"\n`,
      { mode: 0o755 },
    );
    await fs.writeFile(
      path.join(binDir, `npm${executable}`),
      process.platform === "win32" ? "@echo off\r\nexit /b 1\r\n" : "#!/bin/sh\nexit 1\n",
      { mode: 0o755 },
    );

    envSnapshot = captureEnv(["COREPACK_ENABLE_DOWNLOAD_PROMPT", "PATH"]);
    delete process.env.COREPACK_ENABLE_DOWNLOAD_PROMPT;
    process.env.PATH = [binDir, process.env.PATH ?? ""].join(path.delimiter);
    const runCommand: CommandRunner = vi.fn(exec.runCommandWithTimeout);

    await expect(detectGlobalInstallManagerByPresence(runCommand, 10_000)).resolves.toBe("pnpm");

    const probes = vi.mocked(runCommand).mock.calls;
    expect(probes.map(([argv]) => argv)).toEqual([
      ["npm", "root", "-g"],
      ["pnpm", "root", "-g"],
    ]);
    for (const [, options] of probes) {
      expect(options.env).toMatchObject({ COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" });
      // Corepack prompts only on a TTY; a probe must never wait for terminal input.
      expect(options.input).toBe("");
    }
    await expect(fs.readFile(captureFile, "utf8")).resolves.toBe('{"prompt":"0"}');
  });

  it("sets the package launcher under Bun", async () => {
    vi.stubGlobal("process", { ...process, versions: { ...process.versions, bun: "1.4.3" } });
    expect((await createGlobalInstallEnv({}))?.OMNIPOLYMATH_PACKAGE_BUN_LAUNCHER).toBe(
      process.execPath,
    );
  });

  it("resolves portable Git paths from process-local app data only", async () => {
    mockProcessPlatform("win32");
    const base = dirs.make("omnipolymath-update-portable-git-");

    envSnapshot = captureEnv(["LOCALAPPDATA"]);
    const injectedLocalAppData = path.join(base, "injected-local-app-data");
    const trustedLocalAppData = path.join(base, "trusted-local-app-data");
    const injectedGitDir = path.join(injectedLocalAppData, "Omnipolymath/deps/portable-git/cmd");
    const trustedGitDir = path.join(trustedLocalAppData, "Omnipolymath/deps/portable-git/cmd");
    await fs.mkdir(injectedGitDir, { recursive: true });
    await fs.mkdir(trustedGitDir, { recursive: true });

    delete process.env.LOCALAPPDATA;
    const injectedOnlyEnv = await createGlobalInstallEnv({
      LOCALAPPDATA: injectedLocalAppData,
      PATH: "base-bin",
    });
    expect(injectedOnlyEnv?.PATH).not.toContain(injectedGitDir);

    process.env.LOCALAPPDATA = trustedLocalAppData;
    const trustedEnv = await createGlobalInstallEnv({
      LOCALAPPDATA: injectedLocalAppData,
      PATH: "base-bin",
    });
    expect(trustedEnv?.PATH).toContain(trustedGitDir);
    expect(trustedEnv?.PATH).not.toContain(injectedGitDir);
  });

  it("detects install managers from resolved roots and on-disk presence", async () => {
    const base = dirs.make("omnipolymath-update-global-");

    const npmRoot = path.join(base, "npm-root");
    const pnpmRoot = path.join(base, "pnpm-root");
    const bunRoot = path.join(base, ".bun/install/global/node_modules");
    const pkgRoot = path.join(pnpmRoot, "omnipolymath");
    await fs.mkdir(pkgRoot, { recursive: true });
    await fs.mkdir(path.join(npmRoot, "omnipolymath"), { recursive: true });
    await fs.mkdir(path.join(bunRoot, "omnipolymath"), { recursive: true });

    envSnapshot = captureEnv(["BUN_INSTALL"]);
    process.env.BUN_INSTALL = path.join(base, ".bun");

    const runCommand = rootRunner({ npm: npmRoot, pnpm: pnpmRoot });

    await expect(detectGlobalInstallManagerForRoot(runCommand, pkgRoot, 1000)).resolves.toBe(
      "pnpm",
    );
    await expect(detectGlobalInstallManagerByPresence(runCommand, 1000)).resolves.toBe("npm");

    await fs.rm(path.join(npmRoot, "omnipolymath"), { recursive: true, force: true });
    await fs.rm(path.join(pnpmRoot, "omnipolymath"), { recursive: true, force: true });
    await expect(detectGlobalInstallManagerByPresence(runCommand, 1000)).resolves.toBe("bun");
  });

  it("keeps scoped npm self-updates on the running package root", async () => {
    mockProcessPlatform("darwin");
    const base = dirs.make("omnipolymath-update-scoped-probe-");

    // A foreign PATH Node can make the nvm npm report a Homebrew destination.
    const nvmPrefix = path.join(base, "home/.nvm/versions/node/v24.5.0");
    const { globalRoot: nvmRoot, pkgRoot } = await npmFixture(nvmPrefix, "@scope/cli");
    const cellarRoot = path.join(base, "opt/homebrew/Cellar/node/26.3.1/lib/node_modules");

    const runCommand = createNpmRootRunner(cellarRoot);

    await expect(
      resolveTarget(runCommand, pkgRoot, { packageName: "@scope/cli" }),
    ).resolves.toEqual(npmTarget(nvmRoot, pkgRoot));
  });

  it("falls back to the running package root when the npm root probe fails", async () => {
    mockProcessPlatform("darwin");
    const base = dirs.make("omnipolymath-update-probe-failure-");

    const { globalRoot, pkgRoot } = await npmFixture(path.join(base, "usr/local"));

    const runCommand: CommandRunner = async () => commandResult("", 1);

    await expect(resolveTarget(runCommand, pkgRoot)).resolves.toEqual(
      npmTarget(globalRoot, pkgRoot, null),
    );
  });

  it("does not infer npm ownership from path shape alone when the owning npm binary is absent", async () => {
    const base = dirs.make("omnipolymath-update-npm-missing-bin-");

    const { pkgRoot } = await npmFixture(path.join(base, "opt/homebrew"));
    const pathNpmRoot = path.join(base, "nvm/lib/node_modules");

    const runCommand = createNpmRootRunner(pathNpmRoot);

    await expect(detectGlobalInstallManagerForRoot(runCommand, pkgRoot, 1000)).resolves.toBeNull();
    expect(globalInstallArgs("npm", "omnipolymath@latest", pkgRoot)).toEqual(expectedNpmInstall);
  });

  it("honors an explicitly selected direct npm node_modules package root", async () => {
    const base = dirs.make("omnipolymath-update-managed-service-root-");

    const managedNpmRoot = path.join(base, ".omnipolymath/npm/node_modules");
    const pkgRoot = path.join(managedNpmRoot, "omnipolymath");
    const pathNpmRoot = path.join(base, "shell/lib/node_modules");
    const otherPnpmRoot = path.join(base, "pnpm/global/5/node_modules");
    const customNpm = path.join(base, "bin/npm");
    await fs.mkdir(pkgRoot, { recursive: true });
    await fs.mkdir(path.join(otherPnpmRoot, "omnipolymath"), { recursive: true });

    const runCommand = rootRunner(
      {
        npm: pathNpmRoot,
        [customNpm]: pathNpmRoot,
        pnpm: otherPnpmRoot,
      },
      "12.0.0",
    );

    for (const [manager, command] of [
      ["pnpm", "npm"],
      [{ manager: "npm", command: customNpm }, customNpm],
    ] as const) {
      await expect(
        resolveTarget(runCommand, pkgRoot, { manager, honorPackageRoot: true }),
      ).resolves.toEqual({
        ...npmTarget(managedNpmRoot, pkgRoot),
        command,
        directNodeModulesRoot: true,
      });
    }

    expect(
      resolveNpmGlobalPrefixLayoutFromGlobalRoot(managedNpmRoot, {
        allowDirectNodeModulesRoot: true,
      }),
    ).toEqual({
      prefix: path.dirname(managedNpmRoot),
      globalRoot: managedNpmRoot,
      binDir: path.join(managedNpmRoot, ".bin"),
    });
  });

  it.each([
    ["the running package root", false],
    ["virtual-store package roots", true],
  ] as const)("detects custom pnpm global layouts from %s", async (_name, virtualStore) => {
    const base = dirs.make("update-pnpm-");

    const customGlobalDir = path.join(base, "custom-pnpm");
    const customGlobalRoot = path.join(customGlobalDir, "5/node_modules");
    const packageRoot = path.join(customGlobalRoot, "omnipolymath");
    const pkgRoot = virtualStore
      ? path.join(
          customGlobalDir,
          "5/.pnpm/omnipolymath@file+..+pack+omnipolymath-2026.5.6.tgz/node_modules/omnipolymath",
        )
      : packageRoot;
    const defaultPnpmRoot = path.join(base, "default-pnpm/5/node_modules");
    await fs.mkdir(customGlobalRoot, { recursive: true });
    await fs.mkdir(pkgRoot, { recursive: true });
    await writeFixture(customGlobalDir, "5/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    await writeFixture(customGlobalRoot, ".modules.yaml", "layoutVersion: 5\n");
    const runCommand = rootRunner({ npm: null, pnpm: defaultPnpmRoot });

    await expect(detectGlobalInstallManagerForRoot(runCommand, pkgRoot, 1000)).resolves.toBe(
      "pnpm",
    );
    await expect(
      resolveTarget(
        runCommand,
        pkgRoot,
        virtualStore
          ? { manager: "pnpm" as const }
          : {
              manager: { manager: "pnpm" as const, command: "/custom/bin/pnpm" },
              honorPackageRoot: true,
            },
      ),
    ).resolves.toEqual({
      manager: "pnpm",
      command: virtualStore ? "pnpm" : "/custom/bin/pnpm",
      globalRoot: customGlobalRoot,
      packageRoot,
    });
    if (!virtualStore) {
      expect(resolvePnpmGlobalDirFromGlobalRoot(customGlobalRoot)).toBe(customGlobalDir);
    }
  });

  it("allows only Omnipolymath builds for pnpm", () => {
    expect(globalInstallArgs("pnpm", "omnipolymath@latest")).toEqual([
      "pnpm",
      "add",
      "-g",
      "--allow-build=omnipolymath",
      "omnipolymath@latest",
    ]);
  });
  it.each([
    ["omnipolymath@latest", "omnipolymath@latest"],
    ["/tmp/omnipolymath-current.tgz", "omnipolymath@file:/tmp/omnipolymath-current.tgz"],
    ["https://example.test/omnipolymath.tgz", "omnipolymath@https://example.test/omnipolymath.tgz"],
    ["github:krishnashahane/Omnipolymath#main", "omnipolymath@github:krishnashahane/Omnipolymath#main"],
  ] as const)("replaces Bun's global dependency for %s", (spec, expected) => {
    const command = process.versions.bun ? process.execPath : "bun";
    expect(globalInstallArgs("bun", spec)).toEqual([command, "add", "-g", "--trust", expected]);
  });

  it("resolves npm prefix layouts for normal global roots", () => {
    expect(resolveNpmGlobalPrefixLayoutFromGlobalRoot("/opt/omnipolymath/lib/node_modules")).toEqual({
      prefix: "/opt/omnipolymath",
      globalRoot: "/opt/omnipolymath/lib/node_modules",
      binDir: "/opt/omnipolymath/bin",
    });
    expect(resolveNpmGlobalPrefixLayoutFromPrefix("/tmp/stage")).toEqual({
      prefix: "/tmp/stage",
      globalRoot: "/tmp/stage/lib/node_modules",
      binDir: "/tmp/stage/bin",
    });
    expect(resolveNpmGlobalPrefixLayoutFromGlobalRoot("/tmp/node_modules")).toBeNull();
  });

  it.each(["missing", "failed"] as const)(
    "cleans only renamed package directories when pacman is %s",
    async (probe) => {
      mockProcessPlatform("linux");
      vi.spyOn(exec, "runCommandBuffered").mockResolvedValue(
        pkgQueryResult(
          "",
          probe === "missing"
            ? {
                code: null,
                termination: "error",
                error: Object.assign(new Error("pacman unavailable"), { code: "ENOENT" }),
              }
            : { code: 1 },
        ),
      );
      const root = dirs.make("omnipolymath-update-cleanup-");
      await fs.mkdir(path.join(root, ".omnipolymath-123"), { recursive: true });
      await fs.mkdir(path.join(root, ".omnipolymath-456"), { recursive: true });
      await fs.writeFile(path.join(root, ".omnipolymath-file"), "nope", "utf8");
      await fs.mkdir(path.join(root, "omnipolymath"), { recursive: true });

      const result = await cleanupGlobalRenameDirs({
        globalRoot: root,
        packageName: "omnipolymath",
      });
      expect(result.removed.toSorted()).toEqual([".omnipolymath-123", ".omnipolymath-456"]);
      expect((await fs.readdir(root)).toSorted()).toEqual([".omnipolymath-file", "omnipolymath"]);
      expect((await fs.stat(path.join(root, "omnipolymath"))).isDirectory()).toBe(true);
      expect((await fs.stat(path.join(root, ".omnipolymath-file"))).isFile()).toBe(true);
    },
  );

  it("checks installed dist against the packaged inventory", async () => {
    const packageRoot = dirs.make("omnipolymath-update-global-pkg-");

    await writeGlobalPackageJson(packageRoot);
    for (const relativePath of BUNDLED_RUNTIME_SIDECAR_PATHS) {
      await writeFixture(packageRoot, relativePath);
    }
    await writePackageDistInventory(packageRoot);

    await expect(collectInstalledGlobalPackageErrors({ packageRoot })).resolves.toStrictEqual([]);

    await fs.rm(path.join(packageRoot, TELEGRAM_RUNTIME_API));
    await expectPackageError(packageRoot, `missing packaged dist file ${TELEGRAM_RUNTIME_API}`);

    const stale = "dist/extensions/telegram/.omnipolymath-install-stage/node_modules/typebox/code.mjs";
    await writeFixture(packageRoot, stale);
    await expectPackageError(packageRoot, `unexpected packaged dist file ${stale}`);
  });

  it("flags global package roots that resolve into source checkouts", async () => {
    const base = dirs.make("omnipolymath-update-global-source-checkout-");

    const checkoutRoot = path.join(base, "checkout");
    const globalRoot = path.join(base, "prefix/lib/node_modules");
    const packageRoot = path.join(globalRoot, "omnipolymath");
    for (const directory of [".git", "src", "extensions"]) {
      await fs.mkdir(path.join(checkoutRoot, directory), { recursive: true });
    }
    await writeFixture(checkoutRoot, "pnpm-workspace.yaml", "packages: []\n");
    await writeGlobalPackageJson(checkoutRoot, "2026.4.27");
    await fs.mkdir(globalRoot, { recursive: true });
    await fs.symlink(checkoutRoot, packageRoot, "dir");
    const realCheckoutRoot = await fs.realpath(checkoutRoot);

    await expectPackageError(
      packageRoot,
      `global package root resolves to source checkout: ${realCheckoutRoot}`,
    );
  });

  it.each(["missing", "invalid"] as const)(
    "rejects %s inventory on newer installs",
    async (kind) => {
      const packageRoot = dirs.make("omnipolymath-update-global-inventory-");
      await writeGlobalPackageJson(packageRoot, "2026.4.15");
      if (kind === "invalid") {
        await writeFixture(packageRoot, PACKAGE_DIST_INVENTORY_RELATIVE_PATH, "{not-json}\n");
      }
      await expectPackageError(
        packageRoot,
        `${kind} package dist inventory ${PACKAGE_DIST_INVENTORY_RELATIVE_PATH}`,
      );
    },
  );

  it.each([false, true])(
    "enforces critical bundled sidecars with inventory present: %s",
    async (inventory) => {
      const packageRoot = dirs.make("omnipolymath-update-global-sidecars-");
      await writeGlobalPackageJson(packageRoot, inventory ? "2026.4.15" : "1.0.0");
      await writeBundledPluginPackageJson(packageRoot, "telegram", "@omnipolymath/telegram");
      if (inventory) {
        await writePackageDistInventory(packageRoot);
      }
      await expectPackageError(
        packageRoot,
        `missing bundled runtime sidecar ${TELEGRAM_RUNTIME_API}`,
      );
    },
  );
});
