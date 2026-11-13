// Covers agent directory resolution across config and environment overrides.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findDuplicateAgentDirs } from "./agent-dirs.js";
import type { OmnipolymathConfig } from "./types.js";

describe("findDuplicateAgentDirs", () => {
  it("finds duplicate explicit dirs in keyed agent entries", () => {
    const cfg: OmnipolymathConfig = {
      agents: {
        ownership: "explicit",
        entries: {
          alpha: { agentDir: "/srv/shared-agent" },
          beta: { agentDir: "/srv/shared-agent" },
        },
      },
    };

    expect(findDuplicateAgentDirs(cfg)).toEqual([
      { agentDir: "/srv/shared-agent", agentIds: ["alpha", "beta"] },
    ]);
  });

  it.each([
    {
      name: "OMNIPOLYMATH_HOME",
      env: { OMNIPOLYMATH_HOME: "/srv/omnipolymath-home", HOME: "/home/other" },
      stateDir: "/srv/omnipolymath-home/.omnipolymath",
    },
    {
      name: "OMNIPOLYMATH_STATE_DIR",
      env: { OMNIPOLYMATH_STATE_DIR: "/srv/omnipolymath-state", OMNIPOLYMATH_HOME: "/home/other" },
      stateDir: "/srv/omnipolymath-state",
    },
    {
      name: "the supplied home resolver",
      env: {},
      stateDir: "/srv/fallback-home/.omnipolymath",
    },
  ])("detects a configured directory colliding with $name", ({ env, stateDir }) => {
    const agentDir = path.resolve(stateDir, "agents", "alpha", "agent");
    const cfg: OmnipolymathConfig = {
      agents: { entries: { alpha: {}, beta: { agentDir } } },
    };

    expect(findDuplicateAgentDirs(cfg, { env, homedir: () => "/srv/fallback-home" })).toEqual([
      { agentDir, agentIds: ["alpha", "beta"] },
    ]);
  });
});
