import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  appendGatewayLifecycleAuditLog,
  renderCmdRestartLogSetup,
  renderPosixRestartLogSetup,
  resolveGatewayLogPaths,
  resolveGatewayRestartLogPath,
} from "./restart-logs.js";
import { buildPlatformRuntimeLogHints } from "./runtime-hints.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const auditEntry = {
  action: "restart",
  source: "cli",
  mode: "deferred",
  interactive: false,
} as const;
const readLog = (env: NodeJS.ProcessEnv) =>
  fs.readFileSync(resolveGatewayRestartLogPath(env), "utf8");

it("resolves profile-aware gateway logs and restart attempts together", () => {
  const env = { HOME: "/Users/test", OMNIPOLYMATH_PROFILE: "work" };
  expect(resolveGatewayLogPaths(env)).toEqual({
    logDir: "/Users/test/.omnipolymath-work/logs",
    stdoutPath: "/Users/test/.omnipolymath-work/logs/gateway.log",
    stderrPath: "/Users/test/.omnipolymath-work/logs/gateway.err.log",
  });
  expect(resolveGatewayRestartLogPath(env)).toBe(
    "/Users/test/.omnipolymath-work/logs/gateway-restart.log",
  );
});

it("renders best-effort POSIX log setup with escaped paths", () => {
  const setup = renderPosixRestartLogSetup({ HOME: "/Users/test's" });

  expect(setup).toContain(
    "if mkdir -p '/Users/test'\\''s/.omnipolymath/logs' 2>/dev/null && : >>'/Users/test'\\''s/.omnipolymath/logs/gateway-restart.log' 2>/dev/null; then",
  );
  expect(setup).toContain("exec >>'/Users/test'\\''s/.omnipolymath/logs/gateway-restart.log' 2>&1");
});

it("renders CMD log setup with quoted paths", () => {
  const setup = renderCmdRestartLogSetup({ USERPROFILE: "C:\\Users\\Test User" });

  expect(setup.quotedLogPath).toBe('"C:\\Users\\Test User/.omnipolymath/logs/gateway-restart.log"');
  expect(setup.lines).toContain(
    'if not exist "C:\\Users\\Test User/.omnipolymath/logs" mkdir "C:\\Users\\Test User/.omnipolymath/logs" >nul 2>&1',
  );
});

it("appends a profile-aware lifecycle audit line with stable key-value fields", () => {
  const env = { OMNIPOLYMATH_STATE_DIR: tempDirs.make("omnipolymath-lifecycle-audit-") };
  appendGatewayLifecycleAuditLog(env, { ...auditEntry, source: "safe-rpc", pid: 4242 });
  expect(readLog(env)).toMatch(
    /^\[[^\]]+\] omnipolymath gateway lifecycle source=safe-rpc action=restart mode=deferred pid=4242 interactive=0\n$/,
  );
});

it("advertises the actual restart log when a POSIX state path contains a backslash", () => {
  const dir = tempDirs.make("omnipolymath-restart-path-");
  const env = { HOME: dir, OMNIPOLYMATH_STATE_DIR: path.join(dir, String.raw`state\literal`) };
  appendGatewayLifecycleAuditLog(env, auditEntry);

  const hints = buildPlatformRuntimeLogHints({
    platform: "darwin",
    env,
    systemdServiceName: "omnipolymath-gateway",
    windowsTaskName: "Omnipolymath Gateway",
  });
  const advertised = hints.find((hint) => hint.startsWith("Restart attempts: "));
  expect(advertised).toBe(`Restart attempts: ${resolveGatewayRestartLogPath(env)}`);
  expect(readLog(env)).toContain("omnipolymath gateway lifecycle source=cli action=restart");
});

it("does not throw when lifecycle audit logging fails", () => {
  const stateDir = tempDirs.make("omnipolymath-lifecycle-audit-fail-");
  const blocker = path.join(stateDir, "not-a-directory");
  fs.writeFileSync(blocker, "block");

  expect(() =>
    appendGatewayLifecycleAuditLog(
      { OMNIPOLYMATH_STATE_DIR: path.join(blocker, "state") },
      { ...auditEntry, action: "stop", mode: "bootout", interactive: true },
    ),
  ).not.toThrow();
});
