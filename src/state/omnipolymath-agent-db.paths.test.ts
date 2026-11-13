import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { withUserPathBaseDirectory } from "../infra/home-dir.js";
import {
  resolveIncognitoOmnipolymathAgentSqlitePath as incognitoPath,
  resolveOmnipolymathAgentSqlitePath as agentPath,
} from "./omnipolymath-agent-db.paths.js";
import { resolveOmnipolymathStateSqlitePath as statePath } from "./omnipolymath-state-db.paths.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => vi.restoreAllMocks());

function expectedPath(root: string, agentId = "worker"): string {
  return path.join(root, "agents", agentId, "agent", "omnipolymath-agent.sqlite");
}

function expectPaths(env: NodeJS.ProcessEnv, root: string) {
  expect(statePath(env)).toBe(path.join(root, "state", "omnipolymath.sqlite"));
  expect(agentPath({ agentId: "worker", env })).toBe(expectedPath(root));
}

it("follows changes to the same environment without crossing agent roots", () => {
  const root = tempDirs.make("omnipolymath-agent-paths-");
  const env = { OMNIPOLYMATH_STATE_DIR: path.join(root, "first") };
  for (const dir of ["first", "second", "first"]) {
    env.OMNIPOLYMATH_STATE_DIR = path.join(root, dir);
    expect(statePath(env)).toBe(path.join(env.OMNIPOLYMATH_STATE_DIR, "state", "omnipolymath.sqlite"));
    for (const agentId of ["Worker", "other", "Worker"]) {
      expect(agentPath({ agentId, env })).toBe(
        expectedPath(env.OMNIPOLYMATH_STATE_DIR, agentId.toLowerCase()),
      );
    }
    expect(incognitoPath({ agentId: "Worker", env })).toBe(
      path.join(
        path.dirname(expectedPath(env.OMNIPOLYMATH_STATE_DIR)),
        "incognito-omnipolymath-agent.sqlite",
      ),
    );
  }
});

it("resolves relative overrides and explicit paths against the current cwd", () => {
  const root = tempDirs.make("omnipolymath-agent-path-cwd-");
  const cwd = vi.spyOn(process, "cwd");
  const env = { OMNIPOLYMATH_STATE_DIR: "relative-state" };
  for (const dir of ["first", "second", "first"]) {
    const workingDir = path.join(root, dir);
    cwd.mockReturnValue(workingDir);
    expectPaths(env, path.join(workingDir, "relative-state"));
    expect(agentPath({ agentId: "worker", env, path: "custom.sqlite" })).toBe(
      path.join(workingDir, "custom.sqlite"),
    );
  }
});

it("keeps home and updater invocation-base changes visible", () => {
  const root = tempDirs.make("omnipolymath-path-context-");
  for (const name of ["first", "second", "first"]) {
    const home = path.join(root, name);
    expect(statePath({ HOME: home, OMNIPOLYMATH_STATE_DIR: "~/.omnipolymath" })).toBe(
      path.join(home, ".omnipolymath", "state", "omnipolymath.sqlite"),
    );
    withUserPathBaseDirectory(home, () => {
      expectPaths({ OMNIPOLYMATH_STATE_DIR: "relative-state" }, path.join(home, "relative-state"));
    });
  }
});
