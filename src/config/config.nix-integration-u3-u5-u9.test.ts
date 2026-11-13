import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfigPathCandidate } from "./config.js";
import { withTempHome } from "./test-helpers.js";

describe("Nix integration config selection", () => {
  it("expands ~ in OMNIPOLYMATH_CONFIG_PATH override", async () => {
    await withTempHome(async (home) => {
      expect(
        resolveConfigPathCandidate(
          { OMNIPOLYMATH_HOME: home, OMNIPOLYMATH_CONFIG_PATH: "~/.omnipolymath/custom.json" },
          () => home,
        ),
      ).toBe(path.join(home, ".omnipolymath", "custom.json"));
    });
  });
});
