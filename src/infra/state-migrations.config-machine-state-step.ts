import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { resolveDaemonRuntimePinStorePath } from "../daemon/runtime-pin-store.js";
import { resolveOmnipolymathStateSqlitePath } from "../state/omnipolymath-state-db.paths.js";
import { migrateLegacyConfigMachineState } from "./state-migrations.config-machine-state.js";
import { migrateDaemonRuntimePins } from "./state-migrations.daemon-runtime-pins.js";
import { createConfigMigrationSources } from "./state-migrations.prelude.js";
import type { LegacyStateMigrationStep } from "./state-migrations.types.js";

export function createConfigMachineStateStep(params: {
  config: OmnipolymathConfig;
  configPath: string;
  configIncludedPaths: readonly string[];
  stateDir: string;
  env: NodeJS.ProcessEnv;
}): LegacyStateMigrationStep {
  const stateEnv = { ...params.env, OMNIPOLYMATH_STATE_DIR: params.stateDir };
  return {
    id: "config-machine-state",
    phase: "shared",
    source: [
      ...createConfigMigrationSources(params.configPath, params.configIncludedPaths),
      { kind: "sqlite", path: resolveOmnipolymathStateSqlitePath(stateEnv) },
    ],
    target: [
      { kind: "sqlite", path: resolveOmnipolymathStateSqlitePath(stateEnv) },
      { kind: "sqlite", path: resolveDaemonRuntimePinStorePath(stateEnv) },
    ],
    requiredness: "conditional",
    reversibility: "checkpoint-required",
    run: async () => {
      const pins = await migrateDaemonRuntimePins(stateEnv);
      if (pins.warnings.length > 0) {
        return pins;
      }
      const config = migrateLegacyConfigMachineState({ config: params.config, env: stateEnv });
      return { changes: [...pins.changes, ...config.changes], warnings: config.warnings };
    },
  };
}
