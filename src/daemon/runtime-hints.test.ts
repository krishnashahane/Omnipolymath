// Daemon runtime hint tests cover platform-specific daemon guidance.
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPlatformRuntimeLogHints, buildPlatformServiceStartHints } from "./runtime-hints.js";

afterEach(() => vi.unstubAllGlobals());

describe("buildPlatformRuntimeLogHints", () => {
  it("renders launchd log hints on darwin", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "darwin",
        env: {
          HOME: "/Users/test",
          OMNIPOLYMATH_STATE_DIR: "/tmp/omnipolymath-state",
          OMNIPOLYMATH_LOG_PREFIX: "gateway",
        },
        systemdServiceName: "omnipolymath-gateway",
        windowsTaskName: "Omnipolymath Gateway",
      }),
    ).toEqual([
      "Launchd stdout and stderr (if installed): /Users/test/Library/Logs/omnipolymath/gateway.log",
      "Restart attempts: /tmp/omnipolymath-state/logs/gateway-restart.log",
    ]);
  });

  it("renders systemd and windows hints by platform", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "linux",
        env: {
          OMNIPOLYMATH_STATE_DIR: "/tmp/omnipolymath-state",
        },
        systemdServiceName: "omnipolymath-gateway",
        windowsTaskName: "Omnipolymath Gateway",
      }),
    ).toEqual([
      "Logs: journalctl --user -u omnipolymath-gateway.service -n 200 --no-pager",
      "Restart attempts: /tmp/omnipolymath-state/logs/gateway-restart.log",
    ]);
    expect(
      buildPlatformRuntimeLogHints({
        platform: "win32",
        env: {
          OMNIPOLYMATH_STATE_DIR: "/tmp/omnipolymath-state",
        },
        systemdServiceName: "omnipolymath-gateway",
        windowsTaskName: "Omnipolymath Gateway",
      }),
    ).toEqual([
      'Logs: schtasks /Query /TN "Omnipolymath Gateway" /V /FO LIST',
      "Restart attempts: /tmp/omnipolymath-state/logs/gateway-restart.log",
    ]);
  });
});

describe("buildPlatformServiceStartHints", () => {
  it("builds platform-specific service start hints", () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    expect(
      buildPlatformServiceStartHints({
        installHint: "omnipolymath gateway install",
        startCommand: "omnipolymath gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.omnipolymath.gateway.plist",
        systemdServiceName: "omnipolymath-gateway",
        windowsTaskName: "Omnipolymath Gateway",
      }),
    ).toEqual([
      "omnipolymath gateway install",
      "omnipolymath gateway",
      "launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.omnipolymath.gateway.plist",
    ]);
    vi.stubGlobal("process", { ...process, platform: "linux" });
    expect(
      buildPlatformServiceStartHints({
        installHint: "omnipolymath gateway install",
        startCommand: "omnipolymath gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.omnipolymath.gateway.plist",
        systemdServiceName: "omnipolymath-gateway",
        windowsTaskName: "Omnipolymath Gateway",
      }),
    ).toEqual([
      "omnipolymath gateway install",
      "omnipolymath gateway",
      "systemctl --user start omnipolymath-gateway.service",
    ]);
  });
});
