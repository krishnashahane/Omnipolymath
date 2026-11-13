import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSelfContainedCandidatePackage } from "../../scripts/self-contained-candidate-package.mjs";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";
import {
  VERSION,
  registryFixture,
  sha256,
  writeJson,
  writeTarball,
} from "./prepublish-plugin-registry.fixture.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const AI_DEPENDENCIES = { typebox: "1.3.35" };

function candidateFixture(root: string, dependencies: Record<string, string>) {
  const packageDir = path.join(root, "candidate");
  mkdirSync(packageDir);
  const tarball = writeTarball(
    root,
    path.join(packageDir, "omnipolymath-current.tgz"),
    "omnipolymath",
    VERSION,
    {
      bundleDependencies: ["chrome-devtools-mcp"],
      dependencies,
    },
  );
  writeJson(path.join(packageDir, "package-candidate.json"), {
    name: "omnipolymath",
    packageSourceSha: "a".repeat(40),
    sha256: sha256(tarball),
    version: VERSION,
  });
  return { packageDir, tarball };
}

function registryWithAi(root: string) {
  const registry = registryFixture(root, ["@omnipolymath/ai"]);
  writeTarball(root, registry.tarballPath, "@omnipolymath/ai", VERSION, {
    dependencies: AI_DEPENDENCIES,
  });
  registry.manifest.packages[0]!.sha256 = sha256(registry.tarballPath);
  registry.writeManifest();
  return registry;
}

function readTarballJson(tarball: string, entry: string) {
  return JSON.parse(execFileSync("tar", ["-xzOf", tarball, entry], { encoding: "utf8" }));
}

describe("self-contained candidate package", () => {
  it("bundles unpublished core dependencies from the verified registry", () => {
    const root = tempDirs.make("omnipolymath-self-contained-");
    const { packageDir } = candidateFixture(root, { "@omnipolymath/ai": VERSION, ...AI_DEPENDENCIES });
    const registry = registryWithAi(root);
    const outputDir = path.join(root, "output");

    const result = createSelfContainedCandidatePackage({
      packageDir,
      outputDir,
      registryDir: registry.artifactDir,
    });

    const output = path.join(outputDir, "omnipolymath-current.tgz");
    expect(result).toEqual({ bundled: ["@omnipolymath/ai"], sha256: sha256(output), version: VERSION });
    expect(readTarballJson(output, "package/package.json").bundleDependencies).toEqual([
      "chrome-devtools-mcp",
      "@omnipolymath/ai",
    ]);
    const ai = readTarballJson(output, "package/node_modules/@omnipolymath/ai/package.json");
    expect(ai).toMatchObject({ name: "@omnipolymath/ai", version: VERSION });
    expect(ai.dependencies).toBeUndefined();
    expect(
      JSON.parse(readFileSync(path.join(outputDir, "package-candidate.json"), "utf8")),
    ).toMatchObject({
      sha256: result.sha256,
      version: VERSION,
    });
  });

  it("passes the candidate through without a registry", () => {
    const root = tempDirs.make("omnipolymath-self-contained-");
    const { packageDir, tarball } = candidateFixture(root, { "@omnipolymath/ai": VERSION });
    const outputDir = path.join(root, "output");

    const result = createSelfContainedCandidatePackage({ packageDir, outputDir });

    expect(result).toEqual({ bundled: [], sha256: sha256(tarball), version: VERSION });
    expect(readFileSync(path.join(outputDir, "omnipolymath-current.tgz"))).toEqual(
      readFileSync(tarball),
    );
  });

  it("rejects a bundled dependency whose runtime dependencies the root does not pin", () => {
    const root = tempDirs.make("omnipolymath-self-contained-");
    const { packageDir } = candidateFixture(root, { "@omnipolymath/ai": VERSION });
    const registry = registryWithAi(root);

    expect(() =>
      createSelfContainedCandidatePackage({
        packageDir,
        outputDir: path.join(root, "output"),
        registryDir: registry.artifactDir,
      }),
    ).toThrow("root package.json must declare typebox@1.3.35");
  });
});
