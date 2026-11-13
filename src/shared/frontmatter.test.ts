import { expectDefined } from "@omnipolymath/normalization-core";
import { describe, expect, it, test } from "vitest";
import {
  applyOmnipolymathManifestInstallCommonFields,
  parseFrontmatterBool,
  parseOmnipolymathManifestInstallBase,
  resolveOmnipolymathManifestBlock,
  resolveOmnipolymathManifestInstall,
  resolveOmnipolymathManifestOs,
  resolveOmnipolymathManifestRequires,
} from "./frontmatter.js";

describe("shared/frontmatter", () => {
  test("parseFrontmatterBool respects explicit values and fallback", () => {
    expect(parseFrontmatterBool("true", false)).toBe(true);
    expect(parseFrontmatterBool("false", true)).toBe(false);
    expect(parseFrontmatterBool(undefined, true)).toBe(true);
    expect(parseFrontmatterBool("maybe", false)).toBe(false);
  });

  test("resolveOmnipolymathManifestBlock returns undefined for invalid input", () => {
    expect(resolveOmnipolymathManifestBlock({ frontmatter: {} })).toBeUndefined();
    expect(
      resolveOmnipolymathManifestBlock({ frontmatter: { metadata: "not-json5" } }),
    ).toBeUndefined();
    expect(resolveOmnipolymathManifestBlock({ frontmatter: { metadata: "123" } })).toBeUndefined();
    expect(resolveOmnipolymathManifestBlock({ frontmatter: { metadata: "[]" } })).toBeUndefined();
    expect(
      resolveOmnipolymathManifestBlock({ frontmatter: { metadata: "{ nope: { a: 1 } }" } }),
    ).toBeUndefined();
  });

  it("normalizes manifest requirement and os lists", () => {
    expect(
      resolveOmnipolymathManifestRequires({
        requires: {
          bins: "bun, node",
          anyBins: [" ffmpeg ", ""],
          env: ["OMNIPOLYMATH_TOKEN", " OMNIPOLYMATH_URL "],
          config: null,
        },
      }),
    ).toEqual({
      bins: ["bun", "node"],
      anyBins: ["ffmpeg"],
      env: ["OMNIPOLYMATH_TOKEN", "OMNIPOLYMATH_URL"],
      config: [],
    });
    expect(resolveOmnipolymathManifestRequires({})).toBeUndefined();
    expect(resolveOmnipolymathManifestOs({ os: [" darwin ", "linux", ""] })).toEqual([
      "darwin",
      "linux",
    ]);
  });

  it("parses and applies install common fields", () => {
    const raw = { type: " Brew ", id: "brew.git", label: "Git", bins: [" git ", "git"] };
    const expectedRaw = structuredClone(raw);
    const parsed = parseOmnipolymathManifestInstallBase(raw, ["brew", "npm"]);
    const common = { id: "brew.git", label: "Git", bins: ["git", "git"] };
    expect(parsed).toEqual({ raw: expectedRaw, kind: "brew", ...common });
    expect(parseOmnipolymathManifestInstallBase({ kind: "bad" }, ["brew"])).toBeUndefined();
    expect(
      applyOmnipolymathManifestInstallCommonFields<{
        extra: boolean;
        id?: string;
        label?: string;
        bins?: string[];
      }>({ extra: true }, expectDefined(parsed, "manifest install base")),
    ).toEqual({ extra: true, ...common });
  });

  it("prefers explicit kind, ignores invalid common fields, and leaves missing ones untouched", () => {
    const raw = { kind: " npm ", type: "brew", id: 42, label: null, bins: [" ", ""] };
    const expectedRaw = structuredClone(raw);
    const parsed = parseOmnipolymathManifestInstallBase(raw, ["brew", "npm"]);
    expect(parsed).toEqual({ raw: expectedRaw, kind: "npm" });
    expect(
      applyOmnipolymathManifestInstallCommonFields(
        { id: "keep", label: "Keep", bins: ["bun"] },
        parsed!,
      ),
    ).toEqual({ id: "keep", label: "Keep", bins: ["bun"] });
  });

  it("maps install entries through the parser and filters rejected specs", () => {
    const keep = { id: "keep" };
    expect(
      resolveOmnipolymathManifestInstall({ install: [keep, { id: "drop" }, "bad"] }, (entry) =>
        entry === keep ? { id: "keep" } : undefined,
      ),
    ).toEqual([{ id: "keep" }]);
  });
});
