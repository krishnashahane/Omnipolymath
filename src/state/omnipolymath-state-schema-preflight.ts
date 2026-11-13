import type { DatabaseSync } from "node:sqlite";
import { formatErrorMessage } from "../infra/errors.js";
import {
  readSqliteDatabaseCleanClose,
  readSqliteDatabaseCleanCloseRefusal,
} from "../infra/sqlite-database-admission.js";
import { assertSqliteIntegrity } from "../infra/sqlite-integrity.js";
import { admitSqliteSchema, getAdmittedSqliteSchemaFacts } from "../infra/sqlite-schema-facts.js";
import { SqliteSchemaMismatchError } from "../infra/sqlite-schema-issues.js";
import { readSqliteUserVersion, readSqliteWriterAppVersion } from "../infra/sqlite-user-version.js";
import { readRetainedAgentDeletionsFromDatabase } from "./agent-deletion-journal.read.js";
import type {
  AgentDeletionJournalDisposition,
  AgentDeletionJournalPurpose,
} from "./agent-deletion-journal.types.js";
import { readAgentDatabasePreflightTargets } from "./omnipolymath-agent-db-registry.read.js";
import { describeDeferredStateSchemaPublication } from "./omnipolymath-database-preflight.messages.js";
import type {
  AgentDatabasePreflightStats,
  OmnipolymathDatabaseSchemaPreflight,
} from "./omnipolymath-database-preflight.types.js";
import {
  getStateRuntimeSchemaAdmission,
  getStateSchemaVersionAdmission,
} from "./omnipolymath-state-db-admission.js";
import { OMNIPOLYMATH_STATE_SCHEMA_VERSION } from "./omnipolymath-state-db-contract.js";
import {
  assertOmnipolymathStateDatabaseForMaintenance,
  omnipolymathStateMigrationAssertions,
} from "./omnipolymath-state-db-maintenance.js";
import { normalizeOmnipolymathStateSchemaReadError } from "./omnipolymath-state-db-schema-migration-required.js";
import { assertCanonicalStateSchemaShape } from "./omnipolymath-state-db-schema-repair.js";
import { readStateSchemaContentVersion } from "./omnipolymath-state-db-schema-version.js";
import { inspectOmnipolymathStateOwnershipFromDatabase } from "./omnipolymath-state-ownership.js";
import { inspectCurrentStateStartupSchema } from "./omnipolymath-state-schema-inspection.js";
import { readStateSchemaPublicationBlocker } from "./omnipolymath-state-schema-publication.js";
import { resolveSchemaMigrationIntegrityCheck } from "./schema-migration-backup-scope.js";

export type StateSchemaInspectionInput = {
  pathname: string;
  supportedVersion: number;
  requireStartupMigrationReadiness?: boolean;
  verifyCurrentSchemaShape?: boolean;
  scope?: "state";
  purpose: AgentDeletionJournalPurpose;
};

export type StateSchemaInspection = {
  schemas: OmnipolymathDatabaseSchemaPreflight;
  registeredDatabases?: { agentId: string; path: string }[];
  deletionJournal?: AgentDeletionJournalDisposition;
  inspectionErrors: unknown[];
  startupMetrics?: {
    stateIntegrityCheckCount: number;
    stateIntegrityMs: number;
    stateSealCount: number;
    stateIntegrityReason?: AgentDatabasePreflightStats["stateIntegrityReason"];
  };
};

/** Boot/Doctor and restart readers inspect the same captured bytes under their existing owner. */
export function inspectStateDatabaseSchema(
  database: DatabaseSync,
  input: StateSchemaInspectionInput,
): StateSchemaInspection {
  const { pathname, supportedVersion } = input;
  const schemas: OmnipolymathDatabaseSchemaPreflight = { incompatible: [], indeterminate: [] };
  const inspection: StateSchemaInspection = { schemas, inspectionErrors: [] };
  try {
    let cleanClose = false;
    if (input.purpose === "runtime" && readSqliteDatabaseCleanClose(pathname)) {
      // Cold readers open before the seal loads; adopt its catalog before consuming its proof.
      admitSqliteSchema(database);
      cleanClose = getStateRuntimeSchemaAdmission(database)?.startupReady === true;
    }
    const metrics: StateSchemaInspection["startupMetrics"] = input.requireStartupMigrationReadiness
      ? (inspection.startupMetrics = {
          stateIntegrityCheckCount: 0,
          stateIntegrityMs: 0,
          stateSealCount: Number(cleanClose),
        })
      : undefined;
    const admittedVersion =
      input.purpose === "maintenance" && input.verifyCurrentSchemaShape
        ? undefined
        : (getStateSchemaVersionAdmission(database)?.userVersion ??
          getAdmittedSqliteSchemaFacts(database)?.userVersion);
    const stateVersion = admittedVersion ?? readSqliteUserVersion(database);
    const contentVersion =
      stateVersion > supportedVersion
        ? stateVersion
        : readStateSchemaContentVersion(database, stateVersion);
    if (contentVersion > supportedVersion) {
      const writerAppVersion = readSqliteWriterAppVersion(database);
      schemas.incompatible.push({
        kind: "state",
        path: pathname,
        foundVersion: contentVersion,
        supportedVersion,
        ...(writerAppVersion ? { writerAppVersion } : {}),
      });
      // An older target does not make this build's readable registry unavailable.
      if (contentVersion > OMNIPOLYMATH_STATE_SCHEMA_VERSION) {
        return inspection;
      }
    }
    // An older target may have taken the header-only path; this build still needs the content marker.
    const migrationVersion =
      stateVersion > supportedVersion
        ? readStateSchemaContentVersion(database, stateVersion)
        : contentVersion;
    if (migrationVersion < supportedVersion) {
      schemas.pendingMigrations = [
        { kind: "state", path: pathname, foundVersion: stateVersion, supportedVersion },
      ];
    }
    if (stateVersion < contentVersion && migrationVersion === contentVersion) {
      schemas.deferredSchemaPublications = [
        describeDeferredStateSchemaPublication(
          readStateSchemaPublicationBlocker(database),
          pathname,
          stateVersion,
          contentVersion,
        ),
      ];
    }
    if (
      !cleanClose &&
      input.requireStartupMigrationReadiness &&
      contentVersion <= OMNIPOLYMATH_STATE_SCHEMA_VERSION
    ) {
      const integrityStartedAt = performance.now();
      if (metrics) {
        metrics.stateIntegrityCheckCount++;
        metrics.stateIntegrityReason =
          input.purpose === "maintenance"
            ? "maintenance"
            : (readSqliteDatabaseCleanCloseRefusal(database) ?? "startup-not-ready");
      }
      assertSqliteIntegrity(
        database,
        pathname,
        contentVersion < supportedVersion
          ? resolveSchemaMigrationIntegrityCheck({
              kind: "state",
              foundVersion: contentVersion,
              supportedVersion,
            })
          : undefined,
      );
      if (metrics) {
        metrics.stateIntegrityMs = performance.now() - integrityStartedAt;
      }
      assertCanonicalStateSchemaShape(database, pathname);
      // Readiness must reject malformed ownership even when startup has no pending writes.
      inspectOmnipolymathStateOwnershipFromDatabase(database, pathname);
      if (migrationVersion === OMNIPOLYMATH_STATE_SCHEMA_VERSION) {
        const { blockingIssues } = inspectCurrentStateStartupSchema(
          database,
          pathname,
          stateVersion,
        );
        if (blockingIssues.length > 0) {
          throw new SqliteSchemaMismatchError(
            `Omnipolymath state database ${pathname} requires repair: ${blockingIssues.map((issue) => issue.message).join("; ")}; run omnipolymath doctor --fix.`,
          );
        }
      } else {
        omnipolymathStateMigrationAssertions.get(migrationVersion)?.(database, { pathname });
      }
    } else if (
      !cleanClose &&
      input.verifyCurrentSchemaShape &&
      migrationVersion === OMNIPOLYMATH_STATE_SCHEMA_VERSION
    ) {
      try {
        assertOmnipolymathStateDatabaseForMaintenance(database, {
          pathname,
          schemaVersions: { userVersion: stateVersion, contentVersion: migrationVersion },
        });
      } catch (error) {
        inspection.inspectionErrors.push(error);
        schemas.indeterminate.push({
          kind: "state",
          path: pathname,
          reason: formatErrorMessage(error),
        });
      }
    }
    if (input.scope === "state") {
      return inspection;
    }
    try {
      inspection.registeredDatabases = readAgentDatabasePreflightTargets(database, pathname);
      inspection.deletionJournal = readRetainedAgentDeletionsFromDatabase(
        database,
        pathname,
        input.purpose,
      );
    } catch (error) {
      inspection.inspectionErrors.push(error);
      schemas.indeterminate.push({
        kind: "state",
        path: pathname,
        reason: `agent database registry query failed: ${formatErrorMessage(error)}`,
      });
    }
    return inspection;
  } catch (error) {
    if (input.requireStartupMigrationReadiness) {
      throw error;
    }
    const failure = normalizeOmnipolymathStateSchemaReadError(error, pathname);
    inspection.inspectionErrors.push(failure);
    schemas.indeterminate.push({
      kind: "state",
      path: pathname,
      reason: formatErrorMessage(failure),
    });
    return inspection;
  }
}
