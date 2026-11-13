import { resolveConfigPath, resolveStateDir } from "../config/paths.js";
import { resolveOmnipolymathStateSqlitePath } from "../state/omnipolymath-state-db.paths.js";
import { resolvePathViaExistingAncestorSync } from "./boundary-path.js";
import type { ForegroundUpdateOrigin } from "./update-restart-sentinel-payload.js";

export function hasForegroundUpdatePaths(
  origin: ForegroundUpdateOrigin,
  env: NodeJS.ProcessEnv,
): boolean {
  return (
    resolvePathViaExistingAncestorSync(resolveOmnipolymathStateSqlitePath(env)) ===
      origin.stateDatabasePath &&
    resolvePathViaExistingAncestorSync(resolveConfigPath(env, resolveStateDir(env))) ===
      origin.configPath
  );
}
