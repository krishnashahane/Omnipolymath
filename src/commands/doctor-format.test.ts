import { expect, it } from "vitest";
import { buildGatewayRuntimeHints } from "./doctor-format.js";

it.each([
  [
    "win32",
    { status: "stopped", state: "Disabled" },
    ["omnipolymath --profile work gateway start", "omnipolymath --profile work doctor --fix"],
  ],
  [
    "darwin",
    { status: "unknown", missingGuiSession: true },
    ["logged-in macOS GUI session", "omnipolymath --profile work gateway restart"],
  ],
] as const)("renders %s recovery for the selected profile", (platform, runtime, expected) => {
  const hints = buildGatewayRuntimeHints(runtime, {
    platform,
    env: { OMNIPOLYMATH_PROFILE: "work" },
  }).join("\n");
  for (const text of expected) {
    expect(hints).toContain(text);
  }
  expect(hints).not.toContain("likely exited immediately");
});

it.each(["user", "system"] as const)("inspects the %s systemd cgroup", (scope) => {
  const systemd = {
    scope,
    unit: "omnipolymath-gateway.service",
    killMode: "process",
    tasksCurrent: 807,
    memoryCurrent: 11_918_534_246,
  };
  const hints = buildGatewayRuntimeHints(
    { status: "running", systemd },
    { platform: "linux", env: {} },
  ).join("\n");
  expect(hints).toContain("cgroup hygiene: KillMode=process, tasks=807, memory=11.1GiB");
  expect(hints).toContain(`systemctl --${scope} show omnipolymath-gateway.service`);
  expect(hints).toContain(
    `systemd-cgls ${scope === "system" ? "--unit" : "--user-unit"} omnipolymath-gateway.service`,
  );
  expect(hints).toContain("omnipolymath gateway restart");
});

it.each([
  [
    { status: "stopped", systemd: { scope: "system", unit: "omnipolymath.service" } },
    {},
    ["journalctl --system -u omnipolymath.service -n 200 --no-pager"],
    "journalctl --user",
  ],
  [
    { status: "unknown", detail: "System has not been booted with systemd as init system" },
    { WSL_DISTRO_NAME: "Ubuntu" },
    ["[boot]\\nsystemd=true", "wsl --shutdown", "systemctl --user status"],
    "systemd user services are unavailable",
  ],
  [
    {
      status: "unknown",
      detail: "service runtime inspection failed; retry with omnipolymath status --deep",
      inspectionFailure: {
        code: "service-runtime-inspection-failed",
        detail: "systemctl --user unavailable: Failed to connect to bus",
      },
    },
    {},
    ["systemd user services are unavailable"],
    undefined,
  ],
  [
    {
      status: "stopped",
      state: "failed",
      systemd: { result: "exit-code", nRestarts: 5, startLimitBurst: 5 },
    },
    {},
    ["systemd stopped restarting", "omnipolymath gateway restart"],
    "likely exited immediately",
  ],
] as const)("renders Linux recovery for %j", (runtime, env, expected, excluded) => {
  const hints = buildGatewayRuntimeHints(runtime, { platform: "linux", env }).join("\n");
  for (const text of expected) {
    expect(hints).toContain(text);
  }
  if (excluded) {
    expect(hints).not.toContain(excluded);
  }
});
