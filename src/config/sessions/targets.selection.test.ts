import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import type { OmnipolymathConfig } from "../types.omnipolymath.js";
import {
  resolveConfiguredAgentDatabaseCandidatePaths as databaseCandidates,
  resolveConfiguredAgentDatabaseTargets as databaseTargets,
  resolveSessionStoreTargets as selectStores,
} from "./targets.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
it.each([
  ["default", undefined],
  ["template", "{agentId}/sessions.json"],
  ["fixed", "fixed/sessions.json"],
  ["shared", "fixed/shared.sqlite"],
] as const)("selects one database owner without changing %s store ownership", (layout, store) => {
  const root = tempDirs.make("configured-database-selection-");
  const env = { OMNIPOLYMATH_STATE_DIR: root };
  const cfg: OmnipolymathConfig = {
    agents: {
      ownership: "explicit",
      entries: { first: {}, second: {} },
      defaults: { sessionStore: { agentId: "first" } },
    },
    acp: { allowedAgents: ["acp-only"] },
    ...(store ? { session: { store: path.join(root, store) } } : {}),
  };
  const ids = ["first", "second", "omnipolymath", "crestodian"];
  if (layout === "default") {
    ids.push("acp-only");
  }
  const expected = ids.map((agentId) => ({
    agentId,
    path: path.join(root, "agents", agentId, "agent", "omnipolymath-agent.sqlite"),
  }));
  const configured: Record<string, string> =
    layout === "shared"
      ? { first: "shared.sqlite" }
      : {
          first: "omnipolymath-agent.sqlite",
          second: "omnipolymath-agent.second.sqlite",
          "acp-only": "omnipolymath-agent.acp-only.sqlite",
        };
  if (layout !== "default") {
    expected.unshift(
      ...Object.entries(configured).map(([agentId, filename]) => ({
        agentId,
        path: path.join(root, layout === "template" ? agentId : "fixed", filename),
      })),
    );
  }
  const all = databaseTargets(cfg, { env, registeredDatabases: [] });
  expect(all).toHaveLength(expected.length);
  expect(all).toEqual(expect.arrayContaining(expected));
  for (const agentId of ["first", "second", "acp-only", "omnipolymath", "crestodian", "missing"]) {
    expect(databaseTargets(cfg, { env, registeredDatabases: [], agentId })).toEqual(
      expected.filter((target) => target.agentId === agentId),
    );
  }
});

it("resolves reserved startup targets without probing their files", () => {
  const root = tempDirs.make("system-database-targets-");
  const env = { OMNIPOLYMATH_STATE_DIR: root };
  const cfg = { agents: { entries: { main: {} } } };
  const dbPath = path.join(root, "agents", "omnipolymath", "agent", "omnipolymath-agent.sqlite");
  const options = { env, registeredDatabases: [], agentId: "omnipolymath" };
  using lstat = vi.spyOn(fs, "lstatSync");
  using stat = vi.spyOn(fs, "statSync");
  using realpath = vi.spyOn(fs.realpathSync, "native");

  expect(databaseCandidates(cfg, { env })).toContain(dbPath);
  expect(databaseTargets(cfg, options)).toEqual([{ agentId: "omnipolymath", path: dbPath }]);
  for (const probe of [lstat, stat, realpath]) {
    expect(probe.mock.calls.filter(([pathname]) => pathname === dbPath)).toEqual([]);
  }
});

it.each([
  ["agent", ""],
  ["store", ""],
  ["store", "   "],
] as const)("rejects blank --%s (%j) instead of defaulting", (option, value) => {
  expect(() => selectStores({}, { [option]: value })).toThrow(`--${option} must not be blank`);
});
