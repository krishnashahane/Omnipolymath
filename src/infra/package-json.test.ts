import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTestDir } from "../test-helpers/temp-dir.js";
import { readPackageManagerSpec, readPackageName, readPackageVersion } from "./package-json.js";

describe("package-json helpers", () => {
  it("reads package version and trims package name", async () => {
    await withTestDir({ prefix: "omnipolymath-package-json-" }, async (root) => {
      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({
          version: " 1.2.3 ",
          name: "  @omnipolymath/demo  ",
          packageManager: " pnpm@12.0.0 ",
        }),
        "utf8",
      );
      await expect(readPackageVersion(root)).resolves.toBe("1.2.3");
      await expect(readPackageName(root)).resolves.toBe("@omnipolymath/demo");
      await expect(readPackageManagerSpec(root)).resolves.toBe("pnpm@12.0.0");
    });
  });

  it.each([
    { name: "missing package.json", content: undefined, expectedVersion: null, expectedName: null },
    { name: "invalid JSON", content: "{", expectedVersion: null, expectedName: null },
    {
      name: "invalid typed fields",
      content: JSON.stringify({ version: 123, name: "   " }),
      expectedVersion: null,
      expectedName: null,
    },
    {
      name: "blank version strings",
      content: JSON.stringify({ version: "   ", name: "@omnipolymath/demo" }),
      expectedVersion: null,
      expectedName: "@omnipolymath/demo",
    },
  ])("returns normalized nulls for $name", async ({ content, expectedVersion, expectedName }) => {
    await withTestDir({ prefix: "omnipolymath-package-json-" }, async (root) => {
      if (content !== undefined) {
        await fs.writeFile(path.join(root, "package.json"), content, "utf8");
      }
      await expect(readPackageVersion(root)).resolves.toBe(expectedVersion);
      await expect(readPackageName(root)).resolves.toBe(expectedName);
    });
  });
});
