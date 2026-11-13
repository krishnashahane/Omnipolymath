import { describe, expect, it } from "vitest";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import { withEnv } from "../../test-utils/env.js";
import { resolveGatewayModelSelectionPolicy } from "./session-model-selection-policy.js";

const cfg = {
  agents: {
    defaults: { model: "anthropic/claude-opus-4-6" },
    entries: {
      main: {},
      work: { model: "anthropic/claude-sonnet-4-6" },
    },
  },
} satisfies OmnipolymathConfig;

describe("resolveGatewayModelSelectionPolicy", () => {
  it("keeps an admin's ordinary selection session-only", () => {
    expect(
      resolveGatewayModelSelectionPolicy({
        callerScopes: ["operator.admin"],
        cfg,
      }).target,
    ).toBe("session");
  });

  it("discloses the configured agent target to an admin", () => {
    expect(
      resolveGatewayModelSelectionPolicy({
        callerScopes: ["operator.admin"],
        cfg: { agents: { defaults: { modelSelectionScope: "agent" } } },
      }).target,
    ).toBe("agent");
  });

  it("discloses session-only selection without admin scope", () => {
    expect(
      resolveGatewayModelSelectionPolicy({
        callerScopes: ["operator.write"],
        cfg: { agents: { defaults: { modelSelectionScope: "global" } } },
      }).target,
    ).toBe("session");
  });

  it.each(["OMNIPOLYMATH_NIX_MODE", "OMNIPOLYMATH_CONFIG_READONLY"])(
    "discloses session-only selection without writable config in %s",
    (mode) => {
      expect(
        withEnv({ [mode]: "1" }, () =>
          resolveGatewayModelSelectionPolicy({
            callerScopes: ["operator.admin"],
            cfg: { agents: { defaults: { modelSelectionScope: "global" } } },
          }),
        ).target,
      ).toBe("session");
    },
  );
});
