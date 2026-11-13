// Shared cleanup for bundled-discovery real-state test roots.
import fs from "node:fs/promises";
import { closeOmnipolymathStateDatabaseByPathAsync } from "../state/omnipolymath-state-db-cache.js";
import { resolveOmnipolymathStateSqlitePath } from "../state/omnipolymath-state-db.paths.js";

/**
 * Removes a temporary OMNIPOLYMATH_STATE_DIR root after draining its database
 * workers and closing cached handles. The plugins project runs isolate:false, so an open handle
 * would leak into later files, and Windows cannot delete open database files.
 */
export async function removeBundledDiscoveryStateRoot(stateDir: string): Promise<void> {
  await closeOmnipolymathStateDatabaseByPathAsync(
    resolveOmnipolymathStateSqlitePath({ OMNIPOLYMATH_STATE_DIR: stateDir } as NodeJS.ProcessEnv),
  );
  await fs.rm(stateDir, { recursive: true, force: true });
}
