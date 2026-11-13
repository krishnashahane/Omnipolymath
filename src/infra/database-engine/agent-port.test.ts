import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { closeOmnipolymathStateDatabaseByPath } from "../../state/omnipolymath-state-db-cache.js";
import { openOmnipolymathStateDatabase } from "../../state/omnipolymath-state-db.js";
import { resolveAgentPortRoots } from "./agent-port.js";
import { withDatabaseEngineSelection } from "./context.js";
import { resolveDatabaseFamilyEngines } from "./registry.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

it("discovers default, shared auth, explicit session and retained agent stores without changing the registry", async () => {
  const root = tempDirs.make("agent-port-roots-");
  const stateDir = path.join(root, "selected");
  const sharedAuth = path.join(root, "shared-auth");
  const externalAgent = path.join(root, "custom-agent");
  const externalSession = path.join(root, "custom-session", "sessions.json");
  const retired = path.join(root, "retired", "agent.sqlite");
  const unconfigured = path.join(stateDir, "agents", "unconfigured", "agent");
  const systemAgent = path.join(stateDir, "agents", "crestodian", "agent");
  const registryPath = path.join(stateDir, "state", "omnipolymath.sqlite");
  const env = { ...process.env, OMNIPOLYMATH_STATE_DIR: stateDir, OMNIPOLYMATH_AGENT_DIR: sharedAuth };
  await fs.mkdir(unconfigured, { recursive: true });
  await fs.mkdir(systemAgent, { recursive: true });
  const bytes = await withDatabaseEngineSelection(
    { effectiveEngines: resolveDatabaseFamilyEngines({}) },
    async () => {
      const { db } = openOmnipolymathStateDatabase({ env });
      db.prepare(
        "INSERT INTO agent_databases (agent_id, path, schema_version, last_seen_at) VALUES (?, ?, ?, 0)",
      ).run("retired", retired, 21);
      closeOmnipolymathStateDatabaseByPath(registryPath);
      return fs.readFile(registryPath);
    },
  );

  const roots = await withDatabaseEngineSelection(
    { effectiveEngines: resolveDatabaseFamilyEngines({}) },
    () =>
      resolveAgentPortRoots({
        stateDir,
        env: { ...env, OMNIPOLYMATH_STATE_DIR: path.join(root, "unselected") },
        config: {
          // Offline source selection remains authoritative while config is being switched.
          database: { engine: "postgres" },
          agents: { entries: { selected: { agentDir: externalAgent } } },
          session: { store: externalSession },
        },
      }),
  );

  expect(new Set(roots)).toEqual(
    new Set([
      path.join(sharedAuth, "omnipolymath-agent.sqlite"),
      path.join(unconfigured, "omnipolymath-agent.sqlite"),
      path.join(systemAgent, "omnipolymath-agent.sqlite"),
      path.join(externalAgent, "omnipolymath-agent.sqlite"),
      path.join(root, "custom-session", "omnipolymath-agent.sqlite"),
      retired,
    ]),
  );
  expect(await fs.readFile(registryPath)).toEqual(bytes);
});
