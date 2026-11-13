#!/usr/bin/env -S node --import tsx

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expectDefined } from "../packages/normalization-core/src/expect.js";
import { formatErrorMessage } from "../src/infra/errors.ts";
import { type NpmVerifyCommandInvocation, runNpmVerifyCommand } from "./lib/npm-verify-exec.ts";
import { runInstalledWorkspaceBootstrapSmoke } from "./lib/workspace-bootstrap-smoke.mts";
import {
  collectInstalledPackageErrors,
  normalizeInstalledBinaryVersion,
  npmExec,
  resolveInstalledBinaryCommandInvocation,
} from "./omnipolymath-npm-postpublish-verify.ts";
import { buildCmdExeCommandLine, resolveWindowsCmdExePath } from "./windows-cmd-helpers.mjs";

type InstalledPackageJson = {
  version?: string;
};

type PackedPackageJson = {
  dependencies?: Record<string, string>;
  name?: string;
  version?: string;
};

type OmnipolymathNpmPrepublishVerifyArgs =
  | {
      expectedVersion?: string;
      dependencyTarballPaths: string[];
      help: false;
      tarballPath: string;
    }
  | {
      expectedVersion?: undefined;
      dependencyTarballPaths: [];
      help: true;
      tarballPath: "";
    };

export function omnipolymathNpmPrepublishVerifyUsage(): string {
  return "Usage: node --import tsx scripts/omnipolymath-npm-prepublish-verify.ts <tarball.tgz> [expected-version] [dependency.tgz ...]";
}

export function parseOmnipolymathNpmPrepublishVerifyArgs(
  argv: readonly string[],
): OmnipolymathNpmPrepublishVerifyArgs {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const tarballPath = args[0]?.trim() ?? "";
  if (tarballPath === "--help" || tarballPath === "-h") {
    return { dependencyTarballPaths: [], help: true, tarballPath: "" };
  }
  if (!tarballPath) {
    throw new Error(omnipolymathNpmPrepublishVerifyUsage());
  }
  if (tarballPath.startsWith("-")) {
    throw new Error(`Unknown omnipolymath npm prepublish verifier option: ${tarballPath}`);
  }

  const expectedVersion = args[1]?.trim();
  if (expectedVersion?.startsWith("-")) {
    throw new Error(`Unknown omnipolymath npm prepublish verifier option: ${expectedVersion}`);
  }
  const dependencyTarballPaths = args.slice(2).map((value) => value.trim());
  const invalidDependency = dependencyTarballPaths.find(
    (value) => value.length === 0 || value.startsWith("-"),
  );
  if (invalidDependency !== undefined) {
    throw new Error(`Invalid dependency tarball path: ${invalidDependency || "<empty>"}`);
  }

  return expectedVersion
    ? { dependencyTarballPaths, expectedVersion, help: false, tarballPath }
    : { dependencyTarballPaths, help: false, tarballPath };
}

export function usesPreparedLocalDependencyInstall(dependencyTarballCount: number): boolean {
  return dependencyTarballCount === 1;
}

export function assertPreparedOmnipolymathAiDependency(params: {
  aiManifest: PackedPackageJson;
  rootManifest: PackedPackageJson;
}): void {
  if (params.aiManifest.name !== "@omnipolymath/ai" || !params.aiManifest.version) {
    throw new Error("Prepared dependency tarball must contain @omnipolymath/ai with a version.");
  }
  if (params.rootManifest.name !== "omnipolymath") {
    throw new Error("Prepared root tarball must contain the omnipolymath package.");
  }
  if (!params.rootManifest.version || params.rootManifest.version !== params.aiManifest.version) {
    throw new Error(
      `Prepared root and @omnipolymath/ai tarballs must both be version ${params.aiManifest.version}.`,
    );
  }
  if (params.rootManifest.dependencies?.["@omnipolymath/ai"] !== params.aiManifest.version) {
    throw new Error(
      `Prepared root tarball must depend on exact @omnipolymath/ai@${params.aiManifest.version}.`,
    );
  }
}

function readPackedPackageJson(tarballPath: string): PackedPackageJson {
  return JSON.parse(
    execFileSync("tar", ["-xOf", tarballPath, "package/package.json"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }),
  ) as PackedPackageJson;
}

function main(argv = process.argv.slice(2)): void {
  const args = parseOmnipolymathNpmPrepublishVerifyArgs(argv);
  if (args.help) {
    console.log(omnipolymathNpmPrepublishVerifyUsage());
    return;
  }

  const workingDir = mkdtempSync(join(tmpdir(), "omnipolymath-prepublish-"));
  const prefixDir = join(workingDir, "prefix");
  try {
    let binaryInvocation: NpmVerifyCommandInvocation;
    let packageRoot: string;
    if (usesPreparedLocalDependencyInstall(args.dependencyTarballPaths.length)) {
      const aiTarballPath = realpathSync(
        expectDefined(args.dependencyTarballPaths[0], "prepared dependency tarball"),
      );
      assertPreparedOmnipolymathAiDependency({
        aiManifest: readPackedPackageJson(aiTarballPath),
        rootManifest: readPackedPackageJson(args.tarballPath),
      });
      mkdirSync(prefixDir, { recursive: true });
      writeFileSync(
        join(prefixDir, "package.json"),
        `${JSON.stringify(
          {
            private: true,
            dependencies: {
              "@omnipolymath/ai": pathToFileURL(aiTarballPath).href,
              omnipolymath: pathToFileURL(realpathSync(args.tarballPath)).href,
            },
          },
          null,
          2,
        )}\n`,
      );
      npmExec(["install", "--prefix", prefixDir, "--no-fund", "--no-audit"], workingDir);
      packageRoot = join(prefixDir, "node_modules", "omnipolymath");
      const binaryPath = join(
        prefixDir,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "omnipolymath.cmd" : "omnipolymath",
      );
      binaryInvocation =
        process.platform === "win32"
          ? {
              command: resolveWindowsCmdExePath(),
              args: ["/d", "/s", "/c", buildCmdExeCommandLine(binaryPath, ["--version"])],
              windowsVerbatimArguments: true,
            }
          : { command: binaryPath, args: ["--version"] };
    } else {
      npmExec(
        [
          "install",
          "-g",
          "--prefix",
          prefixDir,
          ...args.dependencyTarballPaths.map((dependency) => realpathSync(dependency)),
          realpathSync(args.tarballPath),
          "--no-fund",
          "--no-audit",
        ],
        workingDir,
      );
      const globalRoot = npmExec(["root", "-g", "--prefix", prefixDir], workingDir);
      packageRoot = join(globalRoot, "omnipolymath");
      binaryInvocation = resolveInstalledBinaryCommandInvocation(prefixDir, ["--version"]);
    }
    const pkg = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as InstalledPackageJson;
    const resolvedExpectedVersion = args.expectedVersion || pkg.version?.trim() || "";
    const errors = collectInstalledPackageErrors({
      expectedVersion: resolvedExpectedVersion,
      installedVersion: pkg.version?.trim() ?? "",
      packageRoot,
    });
    const installedBinaryVersion = runNpmVerifyCommand(binaryInvocation, workingDir);
    if (normalizeInstalledBinaryVersion(installedBinaryVersion) !== resolvedExpectedVersion) {
      errors.push(
        `installed omnipolymath binary version mismatch: expected ${resolvedExpectedVersion}, found ${installedBinaryVersion || "<missing>"}.`,
      );
    }
    if (errors.length === 0) {
      runInstalledWorkspaceBootstrapSmoke({ packageRoot });
    }
    if (errors.length > 0) {
      throw new Error(`prepared tarball install failed:\n- ${errors.join("\n- ")}`);
    }
    console.log(
      `omnipolymath-npm-prepublish-verify: prepared tarball install OK (${resolvedExpectedVersion}).`,
    );
  } finally {
    rmSync(workingDir, { force: true, recursive: true });
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entrypoint !== null && import.meta.url === entrypoint) {
  try {
    main();
  } catch (error) {
    console.error(`omnipolymath-npm-prepublish-verify: ${formatErrorMessage(error)}`);
    process.exitCode = 1;
  }
}
