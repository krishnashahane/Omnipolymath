import { describe, expect, it } from "vitest";
import { OmnipolymathSchema } from "./zod-schema.js";

describe("gateway.controlUi.newSessionModelDefaults", () => {
  it.each(["last-used", "configured"])("accepts %s", (value) => {
    expect(
      OmnipolymathSchema.safeParse({ gateway: { controlUi: { newSessionModelDefaults: value } } })
        .success,
    ).toBe(true);
  });
  it("rejects unknown policies", () => {
    expect(
      OmnipolymathSchema.safeParse({ gateway: { controlUi: { newSessionModelDefaults: "locked" } } })
        .success,
    ).toBe(false);
  });
});
