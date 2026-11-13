import path from "node:path";
import { withTempHome } from "omnipolymath/plugin-sdk/test-env";
import { describe, expect, it } from "vitest";
import { unregisterOmnipolymathAgentDatabase } from "../../state/omnipolymath-agent-db-registry.js";
import type { OmnipolymathConfig } from "../config.js";
import { replaceSessionEntry } from "./session-accessor.js";
import { resolveSqliteTargetFromSessionStorePath } from "./session-sqlite-target.js";
import { listKnownSessionStoreAgentIds } from "./targets-discovery.native.js";

async function seedRetiredOwner(
  home: string,
  { sessionKey, ...owner }: { sessionKey: string; defaultAgentId?: string },
  sessionId: string,
) {
  const stateDir = path.join(home, ".omnipolymath");
  const env = { ...process.env, OMNIPOLYMATH_STATE_DIR: stateDir };
  const storePath = path.join(stateDir, "shared", "sessions.json");
  const cfg: OmnipolymathConfig = {
    session: { store: storePath },
    agents: { entries: { ops: {} } },
  };
  await replaceSessionEntry(
    { agentId: "retired", ...owner, env, storePath, sessionKey },
    { sessionId, updatedAt: 1 },
  );
  return { cfg, env, storePath };
}

describe("known session store owners", () => {
  it("includes a retired owner registered under the active shared store", async () => {
    await withTempHome(async (home) => {
      const { cfg, env } = await seedRetiredOwner(
        home,
        { sessionKey: "agent:retired:cron:old:run:expired" },
        "retired-session",
      );

      expect(listKnownSessionStoreAgentIds(cfg, { env }).toSorted()).toEqual(["ops", "retired"]);
    });
  });

  it("keeps a retired fixed-store owner after its registry row is removed", async () => {
    await withTempHome(async (home) => {
      const { cfg, env, storePath } = await seedRetiredOwner(
        home,
        { defaultAgentId: "retired", sessionKey: "agent:retired:cron:old:run:expired" },
        "retired-session",
      );
      const retiredDatabasePath = resolveSqliteTargetFromSessionStorePath(storePath, {
        agentId: "retired",
        defaultAgentId: "retired",
        env,
      }).path;
      unregisterOmnipolymathAgentDatabase({ agentId: "retired", env, path: retiredDatabasePath });

      expect(listKnownSessionStoreAgentIds(cfg, { env }).toSorted()).toEqual(["ops", "retired"]);
    });
  });

  it("finds a retired owner in a durable suffixed sibling without a registry row", async () => {
    await withTempHome(async (home) => {
      const { cfg, env, storePath } = await seedRetiredOwner(
        home,
        { defaultAgentId: "ops", sessionKey: "agent:retired:cron:old:run:suffixed" },
        "retired-suffixed-session",
      );
      const retiredDatabasePath = resolveSqliteTargetFromSessionStorePath(storePath, {
        agentId: "retired",
        defaultAgentId: "ops",
        env,
      }).path;
      expect(path.basename(retiredDatabasePath)).toBe("omnipolymath-agent.retired.sqlite");
      unregisterOmnipolymathAgentDatabase({ agentId: "retired", env, path: retiredDatabasePath });

      expect(listKnownSessionStoreAgentIds(cfg, { env }).toSorted()).toEqual(["ops", "retired"]);
    });
  });
});
