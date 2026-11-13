import type { ConfigFileSnapshot } from "../../../config/types.js";
import type { OmnipolymathConfig } from "../../../config/types.omnipolymath.js";
import { migrateLegacyConfig } from "./legacy-config-migrate.js";

type StateMigrationConfigInput = {
  cfg?: OmnipolymathConfig;
  pluginDoctorConfig?: OmnipolymathConfig;
  sourceConfigBeforeMigrations?: OmnipolymathConfig;
};

export function resolveStateMigrationConfigInput(params: {
  snapshot: ConfigFileSnapshot;
  baseConfig: OmnipolymathConfig;
  /** Validated runtime projection from the guarded post-convergence repair plan. */
  postConvergenceConfig?: OmnipolymathConfig;
}): StateMigrationConfigInput | null {
  const pluginDoctorConfig = (params.snapshot.sourceConfig ??
    params.snapshot.config ??
    params.snapshot.parsed) as OmnipolymathConfig | undefined;
  const sourceConfigBeforeMigrations =
    params.snapshot.sourceConfigBeforeMigrations ?? pluginDoctorConfig;
  const context = {
    sourceConfigBeforeMigrations,
    ...(pluginDoctorConfig ? { pluginDoctorConfig } : {}),
  };
  if (params.postConvergenceConfig) {
    return { cfg: params.postConvergenceConfig, ...context };
  }
  if (params.snapshot.valid) {
    return params.snapshot.legacyIssues.length > 0 && pluginDoctorConfig !== undefined
      ? { cfg: params.baseConfig, pluginDoctorConfig, sourceConfigBeforeMigrations }
      : { cfg: params.baseConfig, sourceConfigBeforeMigrations };
  }
  const migrationSource = pluginDoctorConfig ?? params.snapshot.parsed;
  if (params.snapshot.legacyIssues.length === 0 || migrationSource === undefined) {
    return null;
  }
  const migrated = migrateLegacyConfig(migrationSource, {
    sourceConfigBeforeMigrations: params.snapshot.sourceConfigBeforeMigrations,
  });
  // Plugin config repair may retain a legacy locator until its state migration
  // completes. No config mutation must not prevent that owner from retrying.
  if (!migrated.config || migrated.partiallyValid) {
    return {
      pluginDoctorConfig: (pluginDoctorConfig ?? migrationSource) as OmnipolymathConfig,
    };
  }
  return { cfg: migrated.config, ...context };
}
