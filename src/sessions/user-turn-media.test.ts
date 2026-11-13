import { describe, expect, it } from "vitest";
import { hasPersistedMedia } from "./user-turn-media.js";

describe("hasPersistedMedia", () => {
  it.each([
    ["facts-only", { __omnipolymath: { media: [{ path: "/media/fact.png" }] } }],
    ["url-only", { __omnipolymath: { media: [{ url: "https://example.test/image.png" }] } }],
    ["sparse", { __omnipolymath: { media: [{}, { path: "/media/sparse.png" }] } }],
    ["type-only", { __omnipolymath: { media: [{ contentType: "image/png" }] } }],
    ["media-only", { role: "user", content: "", __omnipolymath: { media: [{ kind: "image" }] } }],
  ])("recognizes $0 persisted rows", (_name, message) => {
    expect(hasPersistedMedia(message)).toBe(true);
  });

  it("rejects empty and alignment-only rows", () => {
    expect(hasPersistedMedia({ MediaPath: "/media/legacy.png" })).toBe(false);
    expect(hasPersistedMedia({ role: "user", content: "" })).toBe(false);
    expect(hasPersistedMedia({ __omnipolymath: { media: [{}] } })).toBe(false);
    expect(hasPersistedMedia({ __omnipolymath: { media: [null] } })).toBe(false);
    expect(hasPersistedMedia({ __omnipolymath: { media: [{ path: " ", contentType: "\t" }] } })).toBe(
      false,
    );
    expect(hasPersistedMedia({ __omnipolymath: { media: [{ kind: "unknown" }] } })).toBe(false);
  });
});
