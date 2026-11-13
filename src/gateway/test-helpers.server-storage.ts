import fs from "node:fs/promises";
import path from "node:path";
import { memorySessionActorOwners } from "../config/sessions/session-actor-memory-owner.js";
import { isPathInside } from "../infra/path-guards.js";
import {
  closeOmnipolymathAgentDatabasesAsync,
  closeOmnipolymathAgentDatabasesForTest,
} from "../state/omnipolymath-agent-db.js";
import { drainOmnipolymathAgentWriteQueuesForTest } from "../state/omnipolymath-agent-write-admission.test-support.js";
import { closeOmnipolymathStateDatabaseByPathAsync } from "../state/omnipolymath-state-db.js";
import { resolveOmnipolymathStateSqlitePath } from "../state/omnipolymath-state-db.paths.js";

export async function closeGatewayTestHomeDatabases(home: string): Promise<void> {
  // External stores can still have queued writes using this home's state.
  await drainOmnipolymathAgentWriteQueuesForTest();
  for (const owner of memorySessionActorOwners.list()) {
    if (isPathInside(home, owner.path)) {
      memorySessionActorOwners.closeDatabase(owner);
    }
  }
  // Release leases before deleting their store, and revoke trust in recreated paths.
  await closeOmnipolymathAgentDatabasesAsync(home);
  closeOmnipolymathAgentDatabasesForTest(home);
  // External agent stores can retain workers whose leases belong to this home.
  await closeOmnipolymathStateDatabaseByPathAsync(
    resolveOmnipolymathStateSqlitePath({ OMNIPOLYMATH_STATE_DIR: path.join(home, ".omnipolymath") }),
  );
}

/** Recreate a suite home's state directory without inheriting stale admissions. */
export async function recreateGatewayTestStateDir(home: string, stateDir: string): Promise<void> {
  // Detached work from the previous case, such as the post-restore subagent
  // sweep, can re-admit these databases after cleanup closed them. Close again
  // at deletion so the recreated database never inherits that admission.
  await closeGatewayTestHomeDatabases(home);
  await fs.rm(stateDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 });
  await fs.mkdir(stateDir, { recursive: true });
}
