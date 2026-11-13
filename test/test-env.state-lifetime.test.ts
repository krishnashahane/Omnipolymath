import { execFileSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listOmnipolymathRegisteredAgentDatabases } from "../src/state/omnipolymath-agent-db-registry-listing.js";
import { closeOmnipolymathStateDatabaseByPath } from "../src/state/omnipolymath-state-db-cache.js";
import { openOmnipolymathStateDatabase } from "../src/state/omnipolymath-state-db.js";
import { resolveOmnipolymathStateSqlitePath } from "../src/state/omnipolymath-state-db.paths.js";
import { captureFullEnv, setTestEnvValue, withPathResolutionEnv } from "../src/test-utils/env.js";
import { cleanupTempDirs, makeTempDir } from "./helpers/temp-dir.js";
import { installTestEnv } from "./test-env.js";

const require = createRequire(import.meta.url);
const pathsModule = path.resolve(import.meta.dirname, "../src/state/omnipolymath-state-db.paths.ts");
const tempDirs = new Set<string>();
const cleanups: Array<() => void> = [];
let sandbox: string;
const homeScope = () => [process.env.HOME, process.env.OMNIPOLYMATH_TEST_HOME];

function installOwnedEnv() {
  const testEnv = installTestEnv({ mode: "hermetic" });
  const databasePath = resolveOmnipolymathStateSqlitePath();
  cleanups.push(() => {
    // Callers close their handles before the environment removes its filesystem tree.
    closeOmnipolymathStateDatabaseByPath(databasePath);
    testEnv.cleanup();
  });
  return { ...testEnv, databasePath };
}

beforeEach(() => {
  const snapshot = captureFullEnv();
  cleanups.push(() => snapshot.restore());
  sandbox = makeTempDir(tempDirs, "omnipolymath-test-state-lifetime-");
  vi.spyOn(os, "tmpdir").mockReturnValue(sandbox);
  setTestEnvValue("VITEST_WORKER_ID", "7");
});

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
  vi.restoreAllMocks();
  cleanupTempDirs(tempDirs);
});

it("does not reuse a legacy database in a recycled PID namespace", () => {
  const legacyPath = path.join(
    sandbox,
    `omnipolymath-test-state/${process.pid}-7/state/omnipolymath.sqlite`,
  );
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec("PRAGMA user_version = 9; CREATE TABLE agent_databases (agent_id TEXT PRIMARY KEY)");
  legacy.close();
  const legacyBytes = fs.readFileSync(legacyPath);
  const testEnv = installOwnedEnv();
  expect(listOmnipolymathRegisteredAgentDatabases()).toEqual([]);
  const database = openOmnipolymathStateDatabase();
  expect(database.path).toBe(path.join(testEnv.tempHome, ".omnipolymath", "state", "omnipolymath.sqlite"));

  cleanups.pop()?.();
  expect(fs.existsSync(testEnv.tempHome)).toBe(false);
  expect(fs.existsSync(database.path)).toBe(false);
  expect(fs.readFileSync(legacyPath)).toEqual(legacyBytes);
});

it("owns distinct nested and subsequent generations and restores the caller's state", () => {
  const callerState = path.join(sandbox, "caller-state");
  fs.mkdirSync(callerState);
  fs.writeFileSync(path.join(callerState, "keep"), "caller-owned");
  setTestEnvValue("OMNIPOLYMATH_STATE_DIR", callerState);
  const callerHome = homeScope();
  const outer = installOwnedEnv();
  const outerDatabase = openOmnipolymathStateDatabase();
  expect(resolveOmnipolymathStateSqlitePath()).toBe(outer.databasePath);
  expect(openOmnipolymathStateDatabase()).toBe(outerDatabase);
  const nestedHome = makeTempDir(tempDirs, "nested-home-", sandbox);
  withPathResolutionEnv(nestedHome, {}, () => {
    expect(resolveOmnipolymathStateSqlitePath()).toBe(
      path.join(nestedHome, ".omnipolymath", "state", "omnipolymath.sqlite"),
    );
  });
  expect(resolveOmnipolymathStateSqlitePath()).toBe(outer.databasePath);

  const inner = installOwnedEnv();
  expect(inner.databasePath).not.toBe(outer.databasePath);
  expect(openOmnipolymathStateDatabase().path).toBe(inner.databasePath);
  cleanups.pop()?.();
  expect(fs.existsSync(inner.tempHome)).toBe(false);
  expect(fs.existsSync(inner.databasePath)).toBe(false);
  expect(homeScope()).toEqual([outer.tempHome, outer.tempHome]);
  expect(openOmnipolymathStateDatabase()).toBe(outerDatabase);

  cleanups.pop()?.();
  expect(fs.existsSync(outer.databasePath)).toBe(false);
  expect(homeScope()).toEqual(callerHome);
  expect(process.env.OMNIPOLYMATH_STATE_DIR).toBe(callerState);
  const next = installOwnedEnv();
  expect([outer.databasePath, inner.databasePath]).not.toContain(next.databasePath);
  expect(fs.readFileSync(path.join(callerState, "keep"), "utf8")).toBe("caller-owned");
});

it("shares the owned path across module reloads, inherited workers, and subprocesses", async () => {
  const testEnv = installOwnedEnv();
  const freshPaths = await vi.importActual<
    typeof import("../src/state/omnipolymath-state-db.paths.js")
  >("../src/state/omnipolymath-state-db.paths.js?lifetime");
  expect(freshPaths.resolveOmnipolymathStateSqlitePath()).toBe(testEnv.databasePath);
  const source = `
      import { resolveOmnipolymathStateSqlitePath } from ${JSON.stringify(pathToFileURL(pathsModule).href)};
      process.stdout.write(resolveOmnipolymathStateSqlitePath());
    `;
  const childPath = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", source],
    { env: { ...process.env }, encoding: "utf8" },
  );
  expect(childPath).toBe(testEnv.databasePath);

  const worker = new Worker(
    `require(${JSON.stringify(require.resolve("tsx/cjs"))});
       const { parentPort } = require("node:worker_threads");
       const { resolveOmnipolymathStateSqlitePath } = require(${JSON.stringify(pathsModule)});
       parentPort.postMessage(resolveOmnipolymathStateSqlitePath());`,
    { eval: true, execArgv: [], env: { ...process.env, VITEST_WORKER_ID: "8" } },
  );
  try {
    expect(await once(worker, "message")).toEqual([testEnv.databasePath]);
  } finally {
    await worker.terminate();
  }
});
