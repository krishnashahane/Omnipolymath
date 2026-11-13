import { clearPluginMetadataLifecycleCaches } from "../plugins/plugin-metadata-lifecycle.js";
import { resolveLegacyCronDefaultStoreKey } from "../state/omnipolymath-state-db-cron-identity-migration.js";
import { prepareOmnipolymathStateDatabaseSchema } from "../state/omnipolymath-state-db.js";
import { resolveOmnipolymathStateSqlitePath } from "../state/omnipolymath-state-db.paths.js";
import { SCHEMA_RECOVERY } from "./schema-migration-diagnostics.js";
import type {
  LegacyStateMigrationEndpoint,
  LegacyStateMigrationMode,
  LegacyStateMigrationStep,
} from "./state-migrations.types.js";

export function createStateSchemaMigrationStep(params: {
  stateDir: string;
  env: NodeJS.ProcessEnv;
  mode: LegacyStateMigrationMode | "doctor-preparation";
  requiredness: LegacyStateMigrationStep["requiredness"];
  integrityCheck?: "quick" | "full";
}): LegacyStateMigrationStep {
  const stateEnv = { ...params.env, OMNIPOLYMATH_STATE_DIR: params.stateDir };
  // Capture selection before pinning physical paths for quarantine and permissions.
  const legacyCronDefaultStoreKey = resolveLegacyCronDefaultStoreKey(
    params.env.OMNIPOLYMATH_STATE_DIR?.trim() || params.env.OMNIPOLYMATH_CONFIG_PATH?.trim()
      ? params.env
      : stateEnv,
  );
  const database: LegacyStateMigrationEndpoint = {
    kind: "sqlite",
    path: resolveOmnipolymathStateSqlitePath(stateEnv),
  };
  return {
    id: "state-schema",
    phase: "shared",
    source: [database],
    target: [database],
    requiredness: params.requiredness,
    reversibility: "checkpoint-required",
    run: async () => {
      const result = await prepareOmnipolymathStateDatabaseSchema(
        { env: stateEnv, legacyCronDefaultStoreKey, integrityCheck: params.integrityCheck },
        params.mode,
      );
      if (result.changes.length > 0) {
        // Schema repair can expose install records hidden from pre-upgrade discovery.
        clearPluginMetadataLifecycleCaches();
      }
      return result.warnings.length > 0 ? { ...result, notices: [SCHEMA_RECOVERY] } : result;
    },
  };
}
