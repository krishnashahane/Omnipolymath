import type { DatabaseSync } from "node:sqlite";
import { readGatewayOwnerLeaseFromDatabase } from "../infra/gateway-owner-lease.read.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { assertSqliteIntegrity } from "../infra/sqlite-integrity.js";
import { SqliteSnapshotCleanupError } from "../infra/sqlite-lifecycle-errors.js";
import { withSqlitePostCommitPublications } from "../infra/sqlite-post-commit.js";
import { resolveSqliteInspectionSignal } from "../infra/sqlite-readonly-worker.js";
import {
  assertSqliteSchemaContains,
  createSqliteTableContractReader,
  readSqliteSchemaCookie,
  type SqliteTableContractReader,
} from "../infra/sqlite-schema-contract.js";
import { throwSqliteSchemaMismatches } from "../infra/sqlite-schema-issues.js";
import { prepareSqliteReadOnlyLocation } from "../infra/sqlite-snapshot-source.js";
import { runSqliteDeferredTransactionSync } from "../infra/sqlite-transaction.js";
import { hasLegacyCronRunLogs } from "../infra/state-legacy-cron-presence.js";
import { hasUpdateDoctorMigrationCapture } from "../infra/update-doctor-migration-attribution.js";
import { readAgentDatabaseLeaseProvenance } from "./omnipolymath-agent-db-lease-provenance.js";
import {
  getStateRuntimeSchemaAdmission,
  publishStateRuntimeSchemaAdmission,
} from "./omnipolymath-state-db-admission.js";
import type { OmnipolymathStateIntegrityAdmission } from "./omnipolymath-state-db-async-lifecycle.js";
import { OMNIPOLYMATH_STATE_SCHEMA_VERSION } from "./omnipolymath-state-db-contract.js";
import { hasHistoricalImageReserveSnapshots } from "./omnipolymath-state-db-image-snapshot-migration.js";
import { assertOmnipolymathStateRuntimeIntegrity } from "./omnipolymath-state-db-integrity-admission.js";
import { assertOmnipolymathStateDatabaseForMaintenance } from "./omnipolymath-state-db-maintenance.js";
import { OmnipolymathStateDatabaseSchemaMigrationRequiredError } from "./omnipolymath-state-db-schema-migration-required.js";
import { assertCanonicalStateSchemaShape } from "./omnipolymath-state-db-schema-repair.js";
import {
  admitStateSchemaFacts,
  assertSupportedStateSchemaVersion,
  readStateSchemaContentVersion,
} from "./omnipolymath-state-db-schema-version.js";
import {
  findMissingLazyStateStartupColumn,
  STATE_RUNTIME_SCHEMA_COMPATIBILITY,
} from "./omnipolymath-state-schema-compatibility.js";
import { OMNIPOLYMATH_STATE_SCHEMA_SQL } from "./omnipolymath-state-schema.js";

/** Doctor must yield while preserving the captured source's WAL artifacts. */
export async function needsOmnipolymathStateDatabaseSchemaRepair(
  pathname: string,
  scope: "automatic" | "doctor" = "automatic",
  integrityCheck: "quick" | "full" = "quick",
): Promise<boolean> {
  if (!hasUpdateDoctorMigrationCapture()) {
    return inspectStateSchemaRepair(pathname, pathname, scope, integrityCheck);
  }
  const signal = resolveSqliteInspectionSignal();
  let prepared: Awaited<ReturnType<typeof prepareSqliteReadOnlyLocation>>;
  try {
    prepared = await prepareSqliteReadOnlyLocation(pathname, {
      preserveSourceArtifacts: true,
      signal,
      reuse: true,
    });
  } catch (error) {
    if (error instanceof SqliteSnapshotCleanupError) {
      throw error;
    }
    signal?.throwIfAborted();
    return true;
  }
  try {
    signal?.throwIfAborted();
    return inspectStateSchemaRepair(pathname, prepared.location, scope, integrityCheck);
  } finally {
    await prepared.cleanupAsync();
  }
}

function inspectStateSchemaRepair(
  pathname: string,
  location: string,
  scope: "automatic" | "doctor",
  integrityCheck: "quick" | "full",
): boolean {
  let database: DatabaseSync | undefined;
  try {
    database = openNodeSqliteDatabase(location, { readOnly: true });
    if (scope === "automatic" && getStateRuntimeSchemaAdmission(database)?.startupReady) {
      return false;
    }
    admitStateSchemaFacts(database, pathname);
    assertSupportedStateSchemaVersion(database, pathname);
    const needsRepair =
      readStateSchemaContentVersion(database) !== OMNIPOLYMATH_STATE_SCHEMA_VERSION ||
      hasLegacyCronRunLogs(database) ||
      (scope === "doctor" && hasHistoricalImageReserveSnapshots(database));
    if (!needsRepair) {
      assertCurrentStateRuntimeSchema(database, pathname);
      if (scope === "doctor") {
        assertSqliteIntegrity(database, pathname, { check: integrityCheck });
      }
    }
    return needsRepair;
  } catch {
    // Preserve the repair path's existing diagnostics for unreadable or noncanonical databases.
    return true;
  } finally {
    database?.close();
  }
}

export function assertCurrentStateRuntimeSchema(
  database: DatabaseSync,
  pathname: string,
  readTable: SqliteTableContractReader = createSqliteTableContractReader(database),
): void {
  const missing = findMissingLazyStateStartupColumn(readTable);
  if (missing) {
    throwSqliteSchemaMismatches(pathname, [
      "missing column " + missing.tableName + "." + missing.columnName,
    ]);
  }
  assertCanonicalStateSchemaShape(database, pathname);
  assertOmnipolymathStateDatabaseForMaintenance(database, { pathname }, readTable);
  assertSqliteSchemaContains(
    database,
    pathname,
    OMNIPOLYMATH_STATE_SCHEMA_SQL,
    STATE_RUNTIME_SCHEMA_COMPATIBILITY,
    readTable,
  );
}

/** Catalog presence is enough to refuse retired history without reading or rewriting its rows. */
export function assertNoLegacyStateRuntimeRepair(database: DatabaseSync, pathname: string): void {
  if (hasLegacyCronRunLogs(database)) {
    throw new OmnipolymathStateDatabaseSchemaMigrationRequiredError("legacy-cron-run-logs", pathname);
  }
}

export function isOmnipolymathStateSchemaFastPathEligible(
  database: DatabaseSync,
  pathname: string,
  integrity?: OmnipolymathStateIntegrityAdmission,
): boolean {
  const admitted = getStateRuntimeSchemaAdmission(database);
  if (admitted) {
    return admitted.startupReady;
  }
  let publishIntegrity: (() => void) | undefined;
  const eligible = withSqlitePostCommitPublications(database, () =>
    runSqliteDeferredTransactionSync(
      database,
      () => {
        const userVersion = assertSupportedStateSchemaVersion(database, pathname);
        if (readStateSchemaContentVersion(database) !== OMNIPOLYMATH_STATE_SCHEMA_VERSION) {
          return false;
        }
        const schemaVersion = readSqliteSchemaCookie(database);
        if (typeof schemaVersion !== "number") {
          throw new Error(`Shared-state database ${pathname} schema version is unavailable.`);
        }
        // Repair must collect fresh facts after this read transaction ends.
        const readTable = createSqliteTableContractReader(database);
        assertCurrentStateRuntimeSchema(database, pathname, readTable);
        assertNoLegacyStateRuntimeRepair(database, pathname);
        const owner = readGatewayOwnerLeaseFromDatabase(database);
        const liveGatewayOwner =
          owner?.state === "live" &&
          owner.pid !== process.pid &&
          Boolean(owner.stateDatabaseProvenance) &&
          owner.stateDatabaseProvenance === readAgentDatabaseLeaseProvenance(pathname);
        // Trust the live Gateway's exact-file ownership; borrowers record no verification or seal.
        if (!liveGatewayOwner) {
          publishIntegrity = assertOmnipolymathStateRuntimeIntegrity(
            database,
            pathname,
            { schemaVersion, userVersion },
            integrity,
          );
        }
        return true;
      },
      { operationLabel: "state.admission.fast-path" },
    ),
  );
  publishIntegrity?.();
  if (eligible) {
    publishStateRuntimeSchemaAdmission(database, true);
  }
  return eligible;
}
