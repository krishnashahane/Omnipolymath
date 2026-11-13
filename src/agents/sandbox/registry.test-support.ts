import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { clearRuntimeConfigSnapshot } from "../../config/runtime-snapshot.js";
import { readGatewayLockProcessNamespace } from "../../infra/gateway-lock-payload.js";
import { acquireGatewayStateOwner } from "../../infra/gateway-state-owner.js";
import {
  closeOmnipolymathAgentDatabasesAsync,
  closeOmnipolymathAgentDatabasesForTest,
} from "../../state/omnipolymath-agent-db.js";
import { resolveOmnipolymathStateSqlitePath } from "../../state/omnipolymath-state-db.paths.js";
import { closeStateDatabaseForTest } from "../../test-utils/database-cleanup.js";

export function acquireSandboxGatewayOwner(configRoot: string) {
  const owner = acquireGatewayStateOwner({
    databasePath: resolveOmnipolymathStateSqlitePath(),
    payload: {
      pid: process.pid,
      processNamespace: readGatewayLockProcessNamespace(),
      createdAt: new Date().toISOString(),
      configPath: path.join(configRoot, "omnipolymath.json"),
      role: "gateway",
    },
  });
  return { ...owner, [Symbol.dispose]: () => owner.release() };
}

export function useSandboxRegistryState(prefix: string, dispose = () => {}) {
  const dirs = useAutoCleanupTempDirTracker((cleanup) =>
    afterEach(async () => {
      dispose();
      vi.restoreAllMocks();
      await closeOmnipolymathAgentDatabasesAsync();
      closeOmnipolymathAgentDatabasesForTest();
      await closeStateDatabaseForTest();
      clearRuntimeConfigSnapshot();
      vi.unstubAllEnvs();
      cleanup();
    }),
  );
  const state = { root: "", make: (...args: Parameters<typeof dirs.make>) => dirs.make(...args) };
  beforeEach(() => {
    state.root = dirs.make(prefix);
    vi.stubEnv("OMNIPOLYMATH_STATE_DIR", state.root);
  });
  return state;
}
