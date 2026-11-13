import { afterEach, expect, it, vi } from "vitest";
import { omnipolymathIdDocumentConfig } from "./omnipolymath-id-document.ts";

const enabled = "data-omnipolymath-id-enabled";
const base = "data-omnipolymath-control-ui-base-path";
afterEach(() => {
  document.documentElement.removeAttribute(enabled);
  document.documentElement.removeAttribute(base);
  vi.restoreAllMocks();
});

it.each([null, "false", "true", "TRUE", "1"])(
  "uses only an explicit public opt-in: %s",
  (value) => {
    const fetch = vi.spyOn(globalThis, "fetch");
    document.documentElement.setAttribute(base, "/claw");
    if (value !== null) {
      document.documentElement.setAttribute(enabled, value);
    }
    expect(omnipolymathIdDocumentConfig()).toEqual(value === "true" ? { basePath: "/claw" } : null);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("requires the serving Gateway's base path even when opted in", () => {
  document.documentElement.setAttribute(enabled, "true");
  expect(omnipolymathIdDocumentConfig()).toBeNull();
});
