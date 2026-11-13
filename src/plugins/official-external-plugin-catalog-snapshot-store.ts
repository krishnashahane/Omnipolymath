/** Persists hosted official plugin catalog snapshots through the shared-state worker. */
import { existsSync } from "node:fs";
import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import { resolveOmnipolymathStateSqlitePath } from "../state/omnipolymath-state-db.paths.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import { HostedCatalogSignedFeedMonotonicityError } from "./official-external-plugin-catalog-source.js";
import type { HostedOfficialExternalPluginCatalogSnapshotStore } from "./official-external-plugin-catalog.types.js";

type HostedOfficialExternalPluginCatalogSnapshotStoreOptions = {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  stateDatabasePath?: string;
};

function resolveDatabaseOptions(options: HostedOfficialExternalPluginCatalogSnapshotStoreOptions) {
  const env = cloneEnvWithPlatformSemantics(options.env ?? process.env);
  if (options.stateDir) {
    env.OMNIPOLYMATH_STATE_DIR = options.stateDir;
  }
  return {
    env,
    path: options.stateDatabasePath || resolveOmnipolymathStateSqlitePath(env),
  };
}

/** Creates a snapshot store backed by the shared `state/omnipolymath.sqlite` database. */
export function createSqliteHostedOfficialExternalPluginCatalogSnapshotStore(
  options: HostedOfficialExternalPluginCatalogSnapshotStoreOptions = {},
): HostedOfficialExternalPluginCatalogSnapshotStore {
  return {
    async read(url) {
      const databaseOptions = resolveDatabaseOptions(options);
      if (!existsSync(databaseOptions.path)) {
        return null;
      }
      const context = captureOmnipolymathStateWorkerContext(databaseOptions);
      const { runOmnipolymathStateWorkerOperation } =
        await import("../state/omnipolymath-state-worker-store.js");
      return (
        (await runOmnipolymathStateWorkerOperation(
          context,
          (scope) => scope.execute({ type: "plugins.catalogSnapshot.read", input: { url } }),
          { existingOnly: true },
        )) ?? null
      );
    },
    async write(snapshot) {
      const now = Date.now();
      const context = captureOmnipolymathStateWorkerContext(resolveDatabaseOptions(options));
      const { runOmnipolymathStateWorkerOperation } =
        await import("../state/omnipolymath-state-worker-store.js");
      const result = await runOmnipolymathStateWorkerOperation(context, (scope) =>
        scope.execute({
          type: "plugins.catalogSnapshot.write",
          input: { snapshot, now },
        }),
      );
      if (!result.ok) {
        throw new HostedCatalogSignedFeedMonotonicityError(result.message);
      }
    },
  };
}
