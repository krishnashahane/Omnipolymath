import fs from "node:fs";
import path from "node:path";
import type { StatementSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { closeOmnipolymathAgentDatabaseByPathAsync } from "../../state/omnipolymath-agent-db-lifecycle.js";
import { openOmnipolymathAgentDatabase } from "../../state/omnipolymath-agent-db.js";
import { withOmnipolymathTestState } from "../../test-utils/omnipolymath-test-state.js";
import { prepareForeignLiveSessionPendingInputEntries } from "./session-accessor.pending-inputs.js";
import { prepareSqliteTranscriptReadScope } from "./session-accessor.sqlite-scope.js";

it.each([
  { locator: "shared.sqlite", file: "shared.sqlite", logicalAgent: "worker", registry: true },
  { locator: "shared.json", file: "shared.sqlite", logicalAgent: "ops", registry: true },
  { locator: "shared.json", file: "shared.ops.sqlite", logicalAgent: "ops", registry: true },
  { locator: "external.sqlite", file: "external.sqlite", logicalAgent: "worker", registry: false },
])("prepares $locator at $file without host SQL or logical-owner substitution", async (fixture) => {
  await withOmnipolymathTestState({ label: "session-physical-target" }, async (state) => {
    const databasePath = path.join(state.root, fixture.file);
    const database = openOmnipolymathAgentDatabase({
      agentId: "ops",
      path: databasePath,
    });
    const statement = Object.getPrototypeOf(database.db.prepare("SELECT 1")) as StatementSync;
    await closeOmnipolymathAgentDatabaseByPathAsync(databasePath);
    const stateDir = path.join(state.root, "empty-state");
    const probes = [
      vi.spyOn(statement, "all"),
      vi.spyOn(statement, "get"),
      vi.spyOn(statement, "run"),
      vi.spyOn(statement, "iterate"),
      vi.spyOn(Object.getPrototypeOf(database.db), "exec"),
      vi.spyOn(Object.getPrototypeOf(database.db), "prepare"),
    ];
    try {
      const resolved = await prepareSqliteTranscriptReadScope({
        agentId: fixture.logicalAgent,
        ...(fixture.registry ? {} : { env: { ...process.env, OMNIPOLYMATH_STATE_DIR: stateDir } }),
        sessionKey: `agent:${fixture.logicalAgent}:main`,
        sessionId: "physical-target",
        storePath: path.join(state.root, fixture.locator),
      });
      expect(resolved).toMatchObject({ agentId: fixture.logicalAgent, path: databasePath });
      expect(resolved.databaseAgentId ?? resolved.agentId).toBe("ops");
      expect(probes.flatMap((probe) => probe.mock.calls)).toEqual([]);
      if (!fixture.registry) {
        expect(resolved.databaseAgentId).toBe("ops");
        expect(fs.existsSync(path.join(stateDir, "state", "omnipolymath.sqlite"))).toBe(false);
      }
    } finally {
      probes.forEach((probe) => probe.mockRestore());
    }
  });
});

it("prepares foreign input exclusion before a session database is created", async () => {
  await withOmnipolymathTestState({ label: "first-input-target" }, async (state) => {
    const storePath = path.join(state.root, "uncreated", "omnipolymath-agent.sqlite");
    const read = await prepareForeignLiveSessionPendingInputEntries({
      agentId: "main",
      sessionKey: "agent:main:first-turn",
      sessionId: "first-turn",
      storePath,
    });
    expect(read()).toEqual(new Map());
    expect(fs.existsSync(storePath)).toBe(false);
  });
});
