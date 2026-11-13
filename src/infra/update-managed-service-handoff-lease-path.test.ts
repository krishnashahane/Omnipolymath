import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { buildServiceEnvironment } from "../daemon/service-env.js";
import { mockProcessPlatform } from "../test-utils/vitest-spies.js";
import * as temporaryRoot from "./tmp-omnipolymath-dir.js";
import { resolveManagedUpdateLeaseDatabasePath } from "./update-managed-service-handoff-lease.js";
import { resolveLegacyGatewayManagedUpdateLeaseDatabasePath } from "./update-managed-service-handoff-legacy-store.js";

const dirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.skipIf(process.platform === "win32")(
  "keeps the per-user lease path when another user owns the shared temp directory",
  () => {
    mockProcessPlatform("linux");
    vi.spyOn(os, "tmpdir").mockReturnValue("/tmp");
    vi.spyOn(process, "getuid").mockReturnValue(501);
    let sharedOwner = 501;
    const resolve = temporaryRoot.resolvePreferredOmnipolymathTmpDir;
    vi.spyOn(temporaryRoot, "resolvePreferredOmnipolymathTmpDir").mockImplementation((options) =>
      resolve({
        ...options,
        platform: "linux",
        getuid: () => 501,
        tmpdir: () => "/tmp",
        accessSync: () => {},
        mkdirSync: () => {},
        lstatSync: (directory) => ({
          isDirectory: () => true,
          isSymbolicLink: () => false,
          mode: directory === "/tmp" ? 0o40775 : 0o40700,
          uid: directory === "/tmp/omnipolymath" ? sharedOwner : 501,
        }),
      }),
    );

    expect(resolveManagedUpdateLeaseDatabasePath()).toBe(
      "/tmp/omnipolymath-501/managed-update-handoffs.sqlite",
    );
    sharedOwner = 502;
    expect(resolveManagedUpdateLeaseDatabasePath()).toBe(
      "/tmp/omnipolymath-501/managed-update-handoffs.sqlite",
    );
  },
);

function useCallerEnvironment(env: Record<string, string | undefined>) {
  for (const name of ["HOME", "TMPDIR", "OMNIPOLYMATH_STATE_DIR", "OMNIPOLYMATH_PROFILE"]) {
    vi.stubEnv(name, env[name]);
  }
}

it.runIf(process.platform === "darwin")(
  "shares one macOS lease store across the Gateway service, terminals, and profiles",
  () => {
    // Observe placement only; the real per-user lease directory stays untouched.
    vi.spyOn(temporaryRoot, "resolvePreferredOmnipolymathTmpDir").mockImplementation(
      (options) => options?.preferredDir ?? "",
    );
    const userTemp = execFileSync("/usr/bin/getconf", ["DARWIN_USER_TEMP_DIR"], {
      encoding: "utf8",
    }).trim();
    const home = dirs.make("handoff-home-");
    const terminal = {
      HOME: home,
      OMNIPOLYMATH_STATE_DIR: path.join(home, ".omnipolymath"),
      TMPDIR: userTemp,
    };
    const otherProfile = {
      ...terminal,
      OMNIPOLYMATH_PROFILE: "work",
      OMNIPOLYMATH_STATE_DIR: path.join(home, ".work"),
    };
    // LaunchAgent environments come from the installer, as `gateway install` writes them.
    const gateway = buildServiceEnvironment({ env: terminal, port: 18789, platform: "darwin" });
    const otherGateway = buildServiceEnvironment({
      env: otherProfile,
      port: 18790,
      platform: "darwin",
    });
    expect(gateway.TMPDIR).toBe(path.join(terminal.OMNIPOLYMATH_STATE_DIR, "tmp"));
    const shared = path.join(
      path.resolve(userTemp),
      `omnipolymath-${process.getuid!()}`,
      "managed-update-handoffs.sqlite",
    );

    for (const caller of [gateway, terminal, otherGateway, otherProfile]) {
      useCallerEnvironment(caller);
      expect(resolveManagedUpdateLeaseDatabasePath()).toBe(shared);
    }
    // Repair still finds custody an earlier Gateway left under its own TMPDIR.
    useCallerEnvironment(terminal);
    expect(resolveLegacyGatewayManagedUpdateLeaseDatabasePath()).toBe(
      path.join(gateway.TMPDIR!, `omnipolymath-${process.getuid!()}`, "managed-update-handoffs.sqlite"),
    );
    // Any other explicit TMPDIR, such as a test runner's private root, stays private.
    const isolated = dirs.make("handoff-isolated-tmp-");
    useCallerEnvironment({ ...terminal, TMPDIR: isolated });
    expect(resolveManagedUpdateLeaseDatabasePath()).toBe(
      path.join(isolated, `omnipolymath-${process.getuid!()}`, "managed-update-handoffs.sqlite"),
    );
  },
);

it.skipIf(process.platform === "win32")(
  "keeps following the caller's temp directory outside macOS",
  () => {
    mockProcessPlatform("linux");
    const terminalTmp = dirs.make("handoff-linux-tmp-");
    useCallerEnvironment({
      HOME: dirs.make("handoff-home-"),
      OMNIPOLYMATH_STATE_DIR: undefined,
      TMPDIR: terminalTmp,
    });
    expect(resolveManagedUpdateLeaseDatabasePath()).toBe(
      path.join(terminalTmp, `omnipolymath-${process.getuid!()}`, "managed-update-handoffs.sqlite"),
    );
  },
);
