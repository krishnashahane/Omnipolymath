import type { OmnipolymathConfigWithLegacyRoster } from "../config/legacy.roster.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import type { PreparedLegacySessionSurfaces } from "../plugins/legacy-session-surfaces.types.js";
import type { PreparedAgentDatabaseMigrationDiscovery } from "./state-migrations.media-persistence-targets.js";
import type {
  LegacyStateMigrationInvocationPurpose,
  LegacyStateMigrationStepReceipt,
  MigrationLogger,
} from "./state-migrations.types.js";

export type AutoMigrateLegacyStateParams = {
  cfg: OmnipolymathConfigWithLegacyRoster;
  sourceConfigBeforeMigrations?: OmnipolymathConfigWithLegacyRoster;
  invocationPurpose?: LegacyStateMigrationInvocationPurpose;
  integrityCheck?: "quick" | "full";
  inspectedSessionEntryPaths?: readonly string[];
  agentDatabaseMigrationDiscovery?: PreparedAgentDatabaseMigrationDiscovery;
  pluginDoctorConfig?: OmnipolymathConfig;
  /** Include inputs captured by the config snapshot that produced cfg. */
  configIncludedPaths?: readonly string[];
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  log?: MigrationLogger;
  now?: () => number;
  doctorOnlyStateMigrations?: boolean;
  legacySessionSurfaces?: PreparedLegacySessionSurfaces;
  onStepReceipt?: (receipt: LegacyStateMigrationStepReceipt) => void;
  beforeWorkspaceStateMigration?: (config: OmnipolymathConfig) => Promise<void>;
};
