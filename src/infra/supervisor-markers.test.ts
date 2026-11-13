import { expect, it } from "vitest";
import { detectGatewayRespawnSupervisor, detectRespawnSupervisor } from "./supervisor-markers.js";

const service = { OMNIPOLYMATH_SERVICE_MARKER: " omnipolymath ", OMNIPOLYMATH_SERVICE_KIND: " gateway " };
const worker = { ...service, OMNIPOLYMATH_SERVICE_KIND: "worker" };
const foreign = { ...service, OMNIPOLYMATH_SERVICE_MARKER: "other" };
const macApp = { XPC_SERVICE_NAME: "ai.omnipolymath.mac" };
type Case = [
  NodeJS.Platform,
  NodeJS.ProcessEnv,
  ReturnType<typeof detectRespawnSupervisor>,
  boolean?,
];

it.each<Case>([
  ["darwin", { OMNIPOLYMATH_LAUNCHD_LABEL: " ai.omnipolymath.gateway " }, "launchd"],
  ["darwin", { OMNIPOLYMATH_LAUNCHD_LABEL: "   " }, null],
  ["darwin", { LAUNCH_JOB_LABEL: "ai.omnipolymath.gateway" }, "launchd"],
  ["darwin", { XPC_SERVICE_NAME: "ai.omnipolymath.gateway" }, "launchd"],
  ["darwin", { LAUNCH_JOB_NAME: "ai.omnipolymath.work", OMNIPOLYMATH_PROFILE: "work" }, "launchd"],
  ["darwin", { LAUNCH_JOB_LABEL: "ai.omnipolymath.mac" }, null],
  ["darwin", macApp, null],
  ["linux", service, null],
  ["linux", service, "systemd", true],
  ["linux", worker, null, true],
  ["linux", foreign, null, true],
  ["win32", { OMNIPOLYMATH_WINDOWS_TASK_NAME: "Omnipolymath Gateway" }, "schtasks"],
  ["win32", service, "schtasks"],
  ["win32", worker, null],
  ["win32", foreign, null],
  ["freebsd", { LAUNCH_JOB_LABEL: "ai.omnipolymath.gateway" }, null],
])("detects %s supervisor from %j", (platform, env, expected, optIn = false) => {
  expect(
    detectRespawnSupervisor(env, platform, {
      includeLinuxOmnipolymathGatewayServiceMarker: optIn,
    }),
  ).toBe(expected);
});

it("keeps external ownership separate from native supervisor detection", () => {
  const env = {
    OMNIPOLYMATH_SUPERVISOR_MODE: "external",
    OMNIPOLYMATH_LAUNCHD_LABEL: "ai.omnipolymath.gateway",
  };

  expect(detectGatewayRespawnSupervisor(env, "darwin")).toBe("external");
  expect(detectRespawnSupervisor(env, "darwin")).toBe("launchd");
});
