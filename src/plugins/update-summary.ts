import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { resolveDefaultPluginExtensionsDir } from "./install-paths.js";
import { attachPluginInstallOwnerMigrations } from "./install-transaction.js";
import { repairInstalledOmnipolymathHostLinks } from "./plugin-peer-link.js";
import type {
  PluginUpdateLogger,
  PluginUpdateOutcome,
  PluginUpdateSummary,
} from "./update-source.js";

export async function finalizePluginUpdateSummary(params: {
  config: OmnipolymathConfig;
  changed: boolean;
  outcomes: PluginUpdateOutcome[];
  ranNpmInstaller: boolean;
  logger: PluginUpdateLogger;
  installOwnerMigrations: Readonly<Record<string, string>>;
  beforePersistentApply?: () => void;
  beforePersistentEffect?: () => void | Promise<void>;
}): Promise<PluginUpdateSummary> {
  let changed = params.changed;
  if (params.ranNpmInstaller) {
    const repaired = await repairInstalledOmnipolymathHostLinks({
      managedNpmRoots: [],
      installRecords: params.config.plugins?.installs ?? {},
      extensionsDir: resolveDefaultPluginExtensionsDir(),
      logger: params.logger,
      beforePersistentApply: params.beforePersistentApply,
      beforePersistentEffect: params.beforePersistentEffect,
      onPackageReadError: (error, packageDir) => {
        params.logger.warn?.(
          `Could not repair omnipolymath peer link at ${packageDir}: ${String(error)}`,
        );
      },
    });
    changed = repaired.registeredRepaired > 0 || changed;
  }
  const summary = { config: params.config, changed, outcomes: params.outcomes };
  return Object.keys(params.installOwnerMigrations).length > 0
    ? attachPluginInstallOwnerMigrations(summary, params.installOwnerMigrations)
    : summary;
}
