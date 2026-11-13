import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import type { SqliteCleanCloseSealRefusal } from "../infra/sqlite-clean-close-seal.js";
import type { SqliteSchemaIssue } from "../infra/sqlite-schema-contract.js";
import type { PreparedAgentDatabaseMigrationDiscovery } from "../infra/state-migrations.media-persistence-targets.js";
import type { AgentDatabaseAdmissionRefusal } from "./agent-database-admission.js";
import type { OmnipolymathSchemaVersions } from "./omnipolymath-schema-versions.js";
import type { OmnipolymathStateSchemaReadAdmission } from "./omnipolymath-state-db-contract.js";
import type { OmnipolymathExternalStateOwnership } from "./omnipolymath-state-ownership.js";

export type AgentDatabasePreflightStats = {
  schemaProcessCount: number;
  schemaInspectionCount: number;
  schemaSnapshotCount: number;
  statePreflightMs?: number;
  agentPreflightMs?: number;
  stateIntegrityCheckCount?: number;
  stateIntegrityMs?: number;
  stateSealCount?: number;
  stateIntegrityReason?: SqliteCleanCloseSealRefusal | "maintenance" | "startup-not-ready";
};

export type IncompatibleOmnipolymathDatabase = {
  kind: "agent" | "state";
  path: string;
  agentId?: string;
  foundVersion: number;
  supportedVersion: number;
  writerAppVersion?: string;
};

export type IndeterminateOmnipolymathDatabase = {
  kind: "agent" | "state";
  path: string;
  reason: string;
  agentId?: string;
};

export type DeferredStateSchemaPublication = {
  kind: "state";
  path: string;
  foundVersion: number;
  contentVersion: number;
  runId?: string;
  publishAfterMs?: number | null;
  message: string;
};

export type OmnipolymathDatabaseSchemaPreflight = {
  incompatible: IncompatibleOmnipolymathDatabase[];
  indeterminate: IndeterminateOmnipolymathDatabase[];
  agentRefusals?: AgentDatabaseAdmissionRefusal[];
  pendingMigrations?: Omit<IncompatibleOmnipolymathDatabase, "writerAppVersion">[];
  /** Current owned schemas that need no repair; full integrity may still be pending. */
  readReadyAgentPaths?: string[];
  deferredSchemaPublications?: DeferredStateSchemaPublication[];
};

export type OmnipolymathStateSchemaPreflightResult = {
  databasePath: string;
  foundVersion: number | null;
  contentVersion?: number;
  deferredPublication?: DeferredStateSchemaPublication;
  issues: SqliteSchemaIssue[];
  ownership: OmnipolymathExternalStateOwnership | null;
  reason?: string;
  requiresWrite: boolean;
  schema: "omnipolymath.state-schema-preflight.v1";
  status: "exact" | "startup-repairable" | "migration-required" | "incompatible" | "indeterminate";
  targetVersion: number;
};

export type OmnipolymathAgentSchemaPreflightResult = Omit<
  OmnipolymathStateSchemaPreflightResult,
  "schema" | "ownership" | "status"
> & {
  schema: "omnipolymath.agent-schema-preflight.v1";
  agentId: string;
  status: "exact" | "incompatible" | "indeterminate";
};

export type OmnipolymathDatabaseSchemaPreflightOperation =
  | "doctor"
  | "gateway-restart"
  | "gateway-startup";

export type OmnipolymathDatabasePreflightOptions = {
  env: NodeJS.ProcessEnv;
  onAgentDatabaseDiscovery?: (prepared: PreparedAgentDatabaseMigrationDiscovery) => void;
  onAgentInspection?: (stats: AgentDatabasePreflightStats) => void;
  /** Reuse the registry targets captured by this admission for subsequent startup discovery. */
  onRegisteredAgentDatabases?: (targets: readonly { agentId: string; path: string }[]) => void;
  scope?: "state";
  signal?: AbortSignal;
  /** False permits isolated online readers and SQLite read marks; true preserves source bytes. */
  preserveSourceArtifacts?: boolean;
  /** Omit for current-runtime checks; updates pass their complete target pair. */
  supportedVersions?: OmnipolymathSchemaVersions;
  verifyCurrentSchemaShape?: boolean;
  requireStartupMigrationReadiness?: boolean;
  /** Consume this startup owner's compatibility headers once, never readiness proof. */
  reuseStartupSchemaPreparation?: boolean;
  configuredAgentDatabaseTargets?:
    | readonly { agentId: string; path: string }[]
    | ((
        registeredDatabases: readonly { agentId: string; path: string }[],
      ) => readonly { agentId: string; path: string }[]);
  configuredAgentDatabaseCandidatePaths?: readonly string[];
  /** Final verification includes required held stores without granting migration authority. */
  inspectHeldAgentDatabaseTargets?: readonly { agentId: string; path: string }[];
  agentAdmissionConfig?: OmnipolymathConfig;
  openStateSchemaReadAdmission?: OmnipolymathStateSchemaReadAdmission;
};

export type OmnipolymathDatabaseReadinessOptions = {
  env: NodeJS.ProcessEnv;
  onAgentInspection?: (stats: AgentDatabasePreflightStats) => void;
  onRegisteredAgentDatabases?: OmnipolymathDatabasePreflightOptions["onRegisteredAgentDatabases"];
} & (
  | {
      operation: "doctor";
      configuredAgentDatabaseTargets: readonly { agentId: string; path: string }[];
      config?: OmnipolymathConfig;
      onDeferredSchemaPublication?: (publication: DeferredStateSchemaPublication) => void;
      onVerified?: (schemas: OmnipolymathDatabaseSchemaPreflight) => void;
    }
  | { operation: "gateway-restart"; config?: OmnipolymathConfig }
  | { operation: "gateway-startup"; config: OmnipolymathConfig }
);
