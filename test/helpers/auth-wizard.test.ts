import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  closeOmnipolymathAgentDatabaseByPath,
  openOmnipolymathAgentDatabase,
} from "../../src/state/omnipolymath-agent-db.js";
import { closeOmnipolymathStateDatabaseByPath } from "../../src/state/omnipolymath-state-db-cache.js";
import { openOmnipolymathStateDatabase } from "../../src/state/omnipolymath-state-db.js";
import { captureFullEnv } from "../../src/test-utils/env.js";
import { setupAuthTestEnv } from "./auth-wizard.js";

beforeEach(() => {
  const env = captureFullEnv();
  return () => env.restore();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it.for([undefined, "custom-agent"])(
  "owns agent directory (%s) until cleanup",
  async (agentSubdir, { onTestFinished }) => {
    const previousEnv = { ...process.env };
    const fixture = await setupAuthTestEnv("auth-wrapper-success-", { agentSubdir });
    onTestFinished(fixture.cleanup);
    expect(fixture.agentDir).toBe(path.join(fixture.stateDir, agentSubdir ?? "agent"));
    expect((await fs.stat(fixture.agentDir)).isDirectory()).toBe(true);
    expect(process.env).toMatchObject({
      OMNIPOLYMATH_AGENT_DIR: fixture.agentDir,
      OMNIPOLYMATH_STATE_DIR: fixture.stateDir,
      OMNIPOLYMATH_CONFIG_PATH: path.join(fixture.stateDir, "omnipolymath.json"),
      HOME: previousEnv.HOME,
    });
    await fixture.cleanup();
    expect(process.env).toEqual(previousEnv);
    await expect(fs.stat(path.dirname(fixture.stateDir))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it.for(["absent", "set"])(
  "releases state after agent mkdir fails with agent override %s",
  async (prior, { onTestFinished }) => {
    vi.stubEnv(
      "OMNIPOLYMATH_AGENT_DIR",
      prior === "set" ? path.join(process.env.HOME!, "prior-agent") : undefined,
    );
    const previousEnv = { ...process.env };
    const failure = new Error("agent mkdir failed");
    let root: string | undefined;
    let shared: ReturnType<typeof openOmnipolymathStateDatabase> | undefined;
    let agent: ReturnType<typeof openOmnipolymathAgentDatabase> | undefined;
    const mkdir = fs.mkdir;
    onTestFinished(async () => {
      try {
        if (agent) {
          closeOmnipolymathAgentDatabaseByPath(agent.path);
        }
        if (shared) {
          closeOmnipolymathStateDatabaseByPath(shared.path);
        }
      } finally {
        if (root) {
          await fs.rm(root, { recursive: true, force: true });
        }
      }
    });
    vi.spyOn(fs, "mkdir").mockImplementation(async (...args) => {
      if (
        typeof args[0] === "string" &&
        args[0] === process.env.OMNIPOLYMATH_AGENT_DIR &&
        path.basename(args[0]) === "faulting-agent"
      ) {
        const stateDir = path.dirname(args[0]);
        root = path.dirname(stateDir);
        expect((await fs.stat(stateDir)).isDirectory()).toBe(true);
        const env = { ...process.env, OMNIPOLYMATH_STATE_DIR: stateDir };
        shared = openOmnipolymathStateDatabase({ env });
        agent = openOmnipolymathAgentDatabase({ agentId: "main", env });
        throw failure;
      }
      return mkdir(...args);
    });
    await expect(
      setupAuthTestEnv("auth-wrapper-failure-", { agentSubdir: "faulting-agent" }),
    ).rejects.toBe(failure);
    expect.soft(process.env).toEqual(previousEnv);
    expect.soft([shared?.db.isOpen, agent?.db.isOpen]).toEqual([false, false]);
    expect(root).toBeDefined();
    await expect(fs.stat(root!)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
