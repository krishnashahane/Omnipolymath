import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getEnvironmentData } from "node:worker_threads";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { resetConfigRuntimeState } from "../../config/runtime-snapshot.js";
import { installGatewayDatabaseEngine } from "../../gateway/server-database-engine.js";
import { closeOmnipolymathAgentDatabases } from "../../state/omnipolymath-agent-db-lifecycle.js";
import { cleanupSessionStateForTest } from "../../test-utils/session-state-cleanup.js";
import { withEngineStoreAdmission } from "./admission-scope.js";
import { resetDatabaseEngineSelectionForTest } from "./context.test-support.js";
import type { DatabaseEngineId } from "./types.js";

const configured: unknown = getEnvironmentData("omnipolymath.test.state.conformance.connection");
export const mixedAgentConnection = typeof configured === "string" ? configured : undefined;
export const mixedAgentPairs = [
  { stateEngine: "sqlite", agentEngine: "sqlite" },
  { stateEngine: "postgres", agentEngine: "postgres" },
  { stateEngine: "postgres", agentEngine: "sqlite" },
  { stateEngine: "sqlite", agentEngine: "postgres" },
] as const;

/** One config-driven Gateway boot and database lifecycle per pair, shared by its cases. */
export function useMixedAgentPair(stateEngine: DatabaseEngineId, agentEngine: DatabaseEngineId) {
  let root: string;
  const prefix = `mixed_agent_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const dirs = useAutoCleanupTempDirTracker((cleanup) =>
    afterAll(async () => {
      try {
        withEngineStoreAdmission(() => closeOmnipolymathAgentDatabases(root));
        await cleanupSessionStateForTest({ stateDir: root });
        if (mixedAgentConnection) {
          const client = new Client({ connectionString: mixedAgentConnection });
          await client.connect();
          try {
            const schemas = await client.query<{ nspname: string }>(
              "SELECT nspname FROM pg_namespace WHERE left(nspname, $1) = $2",
              [prefix.length + 1, `${prefix}_`],
            );
            for (const { nspname } of schemas.rows) {
              await client.query(`DROP SCHEMA "${nspname.replaceAll('"', '""')}" CASCADE`);
            }
          } finally {
            await client.end();
          }
        }
      } finally {
        resetDatabaseEngineSelectionForTest();
        resetConfigRuntimeState();
        vi.unstubAllEnvs();
        cleanup();
      }
    }),
  );
  beforeAll(async () => {
    root = dirs.make("mixed-agent-pair-");
    vi.stubEnv("OMNIPOLYMATH_STATE_DIR", root);
    vi.stubEnv("OMNIPOLYMATH_CONFIG_PATH", path.join(root, "omnipolymath.json"));
    fs.writeFileSync(
      process.env.OMNIPOLYMATH_CONFIG_PATH!,
      JSON.stringify(
        stateEngine === "postgres" || agentEngine === "postgres"
          ? {
              database: {
                engine: "sqlite",
                families: { state: { engine: stateEngine }, agent: { engine: agentEngine } },
                postgres: { connection: mixedAgentConnection!, schemaPrefix: prefix },
              },
            }
          : {},
      ),
    );
    resetDatabaseEngineSelectionForTest();
    resetConfigRuntimeState();
    await installGatewayDatabaseEngine();
  });
  beforeEach(() => {
    vi.stubEnv("OMNIPOLYMATH_STATE_DIR", root);
    vi.stubEnv("OMNIPOLYMATH_CONFIG_PATH", path.join(root, "omnipolymath.json"));
  });
  return {
    get root() {
      return root;
    },
  };
}
