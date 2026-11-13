import { expect, it } from "vitest";
import {
  resolveGatewayNativeServiceIdentityConflict,
  resolveGatewayProfileSuffix,
  resolveGatewayServiceDescription,
  resolveGatewaySystemdServiceNameCandidates,
  resolveNodeServiceIdentityEnvironment,
} from "./constants.js";

it.each([
  [undefined, "ai.omnipolymath.node", "omnipolymath-node", "Omnipolymath Node", "node"],
  ["default", "ai.omnipolymath.node", "omnipolymath-node", "Omnipolymath Node", "node"],
  ["work", "ai.omnipolymath.node.work", "omnipolymath-node-work", "Omnipolymath Node (work)", "node-work"],
])("scopes node service identities to profile %s", (profile, launchd, systemd, windows, log) => {
  expect(resolveNodeServiceIdentityEnvironment({ OMNIPOLYMATH_PROFILE: profile })).toMatchObject({
    OMNIPOLYMATH_LAUNCHD_LABEL: launchd,
    OMNIPOLYMATH_SYSTEMD_UNIT: systemd,
    OMNIPOLYMATH_WINDOWS_TASK_NAME: windows,
    OMNIPOLYMATH_LOG_PREFIX: log,
  });
});

it.each([
  [undefined, ["omnipolymath-gateway", "omnipolymath"]],
  ["default", ["omnipolymath-gateway", "omnipolymath"]],
  ["lisa", ["omnipolymath-gateway-lisa", "omnipolymath-lisa"]],
  ["node", ["omnipolymath-gateway-node"]],
  ["gateway", ["omnipolymath-gateway-gateway"]],
  ["gateway-lisa", ["omnipolymath-gateway-gateway-lisa"]],
] as const)("resolves canonical and unambiguous legacy candidates for %s", (profile, expected) => {
  expect(resolveGatewaySystemdServiceNameCandidates(profile)).toEqual(expected);
});

it.each([
  ["darwin", "OMNIPOLYMATH_LAUNCHD_LABEL", "ai.omnipolymath.gateway"],
  ["linux", "OMNIPOLYMATH_SYSTEMD_UNIT", "omnipolymath-gateway.service"],
  ["win32", "OMNIPOLYMATH_WINDOWS_TASK_NAME", "\\Omnipolymath Gateway (other)"],
] as const)("rejects %s identity overrides for named profiles", (platform, envKey, value) => {
  expect(
    resolveGatewayNativeServiceIdentityConflict(
      { OMNIPOLYMATH_PROFILE: "work", [envKey]: value },
      platform,
    ),
  ).toMatchObject({ envKey });
});

it.each([
  ["linux", { OMNIPOLYMATH_PROFILE: "work", OMNIPOLYMATH_SYSTEMD_UNIT: "omnipolymath-gateway-work" }],
  ["linux", { OMNIPOLYMATH_SYSTEMD_UNIT: "custom-gateway.service" }],
  ["win32", { OMNIPOLYMATH_PROFILE: "work", OMNIPOLYMATH_WINDOWS_TASK_NAME: "Omnipolymath Gateway (work)" }],
] as const)("accepts canonical or default-profile %s identities: %j", (platform, env) => {
  expect(resolveGatewayNativeServiceIdentityConflict(env, platform)).toBeNull();
});

it("trims whitespace from profile suffixes", () => {
  expect(resolveGatewayProfileSuffix("  staging  ")).toBe("-staging");
});

it.each([
  [{ OMNIPOLYMATH_PROFILE: "work" }, "Omnipolymath Gateway (profile: work)"],
  [{ OMNIPOLYMATH_SERVICE_VERSION: "2026.1.10" }, "Omnipolymath Gateway"],
] as const)(
  "describes the service using profile, not legacy version metadata: %j",
  (env, expected) => {
    expect(resolveGatewayServiceDescription({ env })).toBe(expected);
  },
);
