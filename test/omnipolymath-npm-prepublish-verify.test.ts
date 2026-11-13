import { describe, expect, it } from "vitest";
import {
  omnipolymathNpmPrepublishVerifyUsage,
  parseOmnipolymathNpmPrepublishVerifyArgs,
  usesPreparedLocalDependencyInstall,
} from "../scripts/omnipolymath-npm-prepublish-verify.ts";

describe("parseOmnipolymathNpmPrepublishVerifyArgs", () => {
  it("supports help, optional versions, and package-manager separators", () => {
    expect(parseOmnipolymathNpmPrepublishVerifyArgs(["--help"])).toEqual({
      dependencyTarballPaths: [],
      help: true,
      tarballPath: "",
    });
    expect(parseOmnipolymathNpmPrepublishVerifyArgs(["omnipolymath.tgz"])).toEqual({
      dependencyTarballPaths: [],
      help: false,
      tarballPath: "omnipolymath.tgz",
    });
    expect(parseOmnipolymathNpmPrepublishVerifyArgs(["--", "omnipolymath.tgz", "2026.3.23"])).toEqual({
      dependencyTarballPaths: [],
      expectedVersion: "2026.3.23",
      help: false,
      tarballPath: "omnipolymath.tgz",
    });
  });

  it("rejects missing, option-like, and extra arguments before installing", () => {
    expect(() => parseOmnipolymathNpmPrepublishVerifyArgs([])).toThrow(
      omnipolymathNpmPrepublishVerifyUsage(),
    );
    expect(() => parseOmnipolymathNpmPrepublishVerifyArgs(["--tag"])).toThrow(
      "Unknown omnipolymath npm prepublish verifier option: --tag",
    );
    expect(() => parseOmnipolymathNpmPrepublishVerifyArgs(["omnipolymath.tgz", "--tag"])).toThrow(
      "Unknown omnipolymath npm prepublish verifier option: --tag",
    );
    expect(
      parseOmnipolymathNpmPrepublishVerifyArgs(["omnipolymath.tgz", "2026.3.23", "llm-core.tgz", "ai.tgz"]),
    ).toEqual({
      dependencyTarballPaths: ["llm-core.tgz", "ai.tgz"],
      expectedVersion: "2026.3.23",
      help: false,
      tarballPath: "omnipolymath.tgz",
    });
    expect(() =>
      parseOmnipolymathNpmPrepublishVerifyArgs(["omnipolymath.tgz", "2026.3.23", "--bad"]),
    ).toThrow("Invalid dependency tarball path: --bad");
  });
});

describe("usesPreparedLocalDependencyInstall", () => {
  it("uses the prepared local project only for the single AI tarball release path", () => {
    expect(usesPreparedLocalDependencyInstall(0)).toBe(false);
    expect(usesPreparedLocalDependencyInstall(1)).toBe(true);
    expect(usesPreparedLocalDependencyInstall(2)).toBe(false);
  });
});
