// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildOmnipolymathToolFallbackText } from "./prompt-surface.js";

describe("buildOmnipolymathToolFallbackText", () => {
  it("does not invent tool names when the structured list is unavailable", () => {
    const text = buildOmnipolymathToolFallbackText({
      surface: "omnipolymath_main",
    });

    expect(text).toContain("Use only exposed tools");
    expect(text).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
  });
});
