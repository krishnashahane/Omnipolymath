import type { EngineConnection } from "../infra/sql-connection.js";
import {
  withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnly,
  withExistingOmnipolymathStateDatabaseReadOnly,
} from "../state/omnipolymath-state-db-readonly.js";
import {
  INSTALLED_PLUGIN_INDEX_STATE_KEY,
  readPluginMetadataStateRowsInDatabase,
  type PluginMetadataStateKey,
  type PluginMetadataStateRow,
  type PluginMetadataStateSelector,
} from "./plugin-metadata-state.kernel.js";

export {
  INSTALLED_PLUGIN_INDEX_STATE_KEY,
  type PluginMetadataStateKey,
  type PluginMetadataStateRow,
  type PluginMetadataStateSelector,
} from "./plugin-metadata-state.kernel.js";

/** Shared inspection commands use the same existing-only, artifact-preserving reader. */
export function readPluginMetadataStateRowSync(
  selector: PluginMetadataStateSelector,
  databaseOptions: Parameters<typeof withExistingOmnipolymathStateDatabaseReadOnly>[1],
  artifactPreservingReadOnly = false,
): { value_json: string } | undefined {
  const row = readPluginMetadataStateRowsSync(
    [
      selector === "installed-index"
        ? INSTALLED_PLUGIN_INDEX_STATE_KEY
        : "plugins.bundledDiscovery",
    ],
    databaseOptions,
    artifactPreservingReadOnly,
  )[0];
  return row ? { value_json: row.value_json } : undefined;
}

/** Acquire related metadata facts from the same prepared database bytes. */
export function readPluginMetadataStateRowsSync(
  stateKeys: readonly PluginMetadataStateKey[],
  databaseOptions: Parameters<typeof withExistingOmnipolymathStateDatabaseReadOnly>[1],
  artifactPreservingReadOnly = false,
): PluginMetadataStateRow[] {
  const read = ({ db }: { db: EngineConnection }) =>
    readPluginMetadataStateRowsInDatabase(db, stateKeys);
  return (
    (artifactPreservingReadOnly
      ? withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnly(read, databaseOptions)
      : withExistingOmnipolymathStateDatabaseReadOnly(read, databaseOptions)) ?? []
  );
}
