import { describe, expect, it } from "vitest";
import {
  assertConfigWriteAllowedInCurrentMode,
  ConfigReadOnlyError,
  NixModeConfigMutationError,
} from "./config-write-guard.js";

describe("config write policy", () => {
  it.each([undefined, "true"])("leaves writes enabled for OMNIPOLYMATH_CONFIG_READONLY=%s", (value) => {
    expect(() =>
      assertConfigWriteAllowedInCurrentMode({ env: { OMNIPOLYMATH_CONFIG_READONLY: value } }),
    ).not.toThrow();
  });

  it("reports external management without Nix guidance", () => {
    const run = () =>
      assertConfigWriteAllowedInCurrentMode({
        env: { OMNIPOLYMATH_CONFIG_READONLY: "1" },
        configPath: "/managed/omnipolymath.json",
      });
    expect(run).toThrow(ConfigReadOnlyError);
    expect(run).toThrow("external deployment source");
    expect(run).toThrow("/managed/omnipolymath.json");
    expect(run).not.toThrow(/Nix|nix-omnipolymath/);
  });

  it.each([undefined, "1"])(
    "preserves Nix policy and guidance with OMNIPOLYMATH_CONFIG_READONLY=%s",
    (value) => {
      expect(() =>
        assertConfigWriteAllowedInCurrentMode({
          env: { OMNIPOLYMATH_NIX_MODE: "1", OMNIPOLYMATH_CONFIG_READONLY: value },
        }),
      ).toThrow(NixModeConfigMutationError);
    },
  );
});
