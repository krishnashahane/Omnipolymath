import { describe, expect, it } from "vitest";
import { shouldUseGatewayOwnerProfile } from "./gateway-owner-profile.js";

describe("shouldUseGatewayOwnerProfile with named roles", () => {
  const base = { role: "operator", rolesConfigured: true } as const;

  it("keeps an Omnipolymath ID owner device on the owner profile, but not a plain trusted proxy", () => {
    expect(
      shouldUseGatewayOwnerProfile({ ...base, authMethod: "trusted-proxy", omnipolymathIdOwner: true }),
    ).toBe(true);
    expect(shouldUseGatewayOwnerProfile({ ...base, authMethod: "trusted-proxy" })).toBe(false);
    expect(
      shouldUseGatewayOwnerProfile({
        ...base,
        authMethod: "trusted-proxy",
        omnipolymathIdOwner: true,
        authenticatedUserId: "omnipolymath-id:member",
      }),
    ).toBe(false);
  });
});
