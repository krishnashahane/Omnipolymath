import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertGatewayServiceMutationAllowed,
  formatExternalSupervisorUpdateRequired,
  isGatewayExternallySupervised,
  NON_DEFAULT_INSTALL_SERVICE_SKIP_REASON,
} from "./gateway-supervision.js";

const profileEnv = () => {
  const HOME = os.userInfo().homedir;
  const OMNIPOLYMATH_STATE_DIR = path.join(HOME, ".omnipolymath-work");
  return {
    HOME,
    OMNIPOLYMATH_PROFILE: "work",
    OMNIPOLYMATH_STATE_DIR,
    OMNIPOLYMATH_CONFIG_PATH: path.join(OMNIPOLYMATH_STATE_DIR, "omnipolymath.json"),
  };
};
const mutate = (env: NodeJS.ProcessEnv) => () =>
  assertGatewayServiceMutationAllowed("restart the gateway", env);
afterEach(() => vi.restoreAllMocks());

describe("gateway supervision", () => {
  it("defaults to automatic supervision", () => {
    expect(isGatewayExternallySupervised({})).toBe(false);
  });

  it("blocks native service mutation with actionable guidance", () => {
    expect(mutate({ OMNIPOLYMATH_SUPERVISOR_MODE: "external" })).toThrow(
      "Omnipolymath gateway lifecycle is managed by an external supervisor " +
        "(OMNIPOLYMATH_SUPERVISOR_MODE=external). Use that supervisor to restart the gateway.",
    );
  });

  it("blocks native service mutation for non-default install identity", () => {
    expect(
      mutate({ HOME: "/home/operator", OMNIPOLYMATH_CONFIG_PATH: "/tmp/copied-omnipolymath.json" }),
    ).toThrow(
      `${NON_DEFAULT_INSTALL_SERVICE_SKIP_REASON}. Rerun with HOME set to the OS account home, OMNIPOLYMATH_HOME either unset or pointing at that same home, and OMNIPOLYMATH_STATE_DIR and OMNIPOLYMATH_CONFIG_PATH either unset or pointing at the canonical paths for that account home and profile to restart the gateway.`,
    );
  });

  it("allows native service mutation for a named profile's canonical state dir", () => {
    expect(mutate(profileEnv())).not.toThrow();
  });

  it.each([
    ["darwin", "macOS", "OMNIPOLYMATH_LAUNCHD_LABEL", "ai.omnipolymath.gateway"],
    ["linux", "Linux", "OMNIPOLYMATH_SYSTEMD_UNIT", "omnipolymath-gateway.service"],
    ["win32", "Windows", "OMNIPOLYMATH_WINDOWS_TASK_NAME", "Omnipolymath Gateway"],
  ] as const)(
    "rejects named-profile service overrides on %s",
    (platform, platformName, envKey, value) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      expect(mutate({ ...profileEnv(), [envKey]: value })).toThrow(
        `named profiles cannot override ${envKey} for ${platformName} service management`,
      );
    },
  );

  it("rejects macOS profile names that collide with reserved LaunchAgent identities", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    expect(mutate({ OMNIPOLYMATH_PROFILE: "gateway" })).toThrow(
      'macOS profile "gateway" conflicts with a reserved LaunchAgent identity',
    );
  });

  it.each([
    { platform: "darwin" as const, platformName: "macOS" },
    { platform: "win32" as const, platformName: "Windows" },
  ])(
    "rejects case-distinct native service identities on $platformName",
    ({ platform, platformName }) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      expect(mutate({ OMNIPOLYMATH_PROFILE: "Main" })).toThrow(
        `${platformName} profile "Main" is not lowercase-safe for case-insensitive state and native-service paths`,
      );
    },
  );

  it("explains why self-update must be delegated", () => {
    expect(formatExternalSupervisorUpdateRequired()).toContain(
      "stop the gateway, update and finalize the runtime, then restart it safely",
    );
  });
});
