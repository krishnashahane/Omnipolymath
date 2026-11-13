import type { DatabaseSync } from "node:sqlite";
import { isMainThread } from "node:worker_threads";
import { prepareClientCredentialMigration } from "../infra/client-credential-migration.js";
import type { ClientCredentialCustody } from "../infra/client-credential-store.js";
import { repairCanonicalSqliteIndexes } from "../infra/sqlite-index-schema.js";
import { assertSqliteIntegrity } from "../infra/sqlite-integrity.js";
import { getAdmittedSqliteSchemaFacts } from "../infra/sqlite-schema-facts.js";
import {
  hasNonStrictSqliteTables,
  migrateSqliteSchemaToStrictInTransaction,
} from "../infra/sqlite-strict.js";
import { getSqliteWorkerStateIntegrityAdmission } from "../infra/sqlite-worker-state-context.js";
import { StartupMaintenanceRequiredError } from "../infra/startup-maintenance-required.js";
import { withStateDatabaseSchemaMaintenance } from "../infra/state-database-maintenance.js";
import { migrateLegacyCronRunLogsToTaskRuns } from "../infra/state-migrations.cron-run-logs.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { hasPreJournalStateSchema } from "./agent-deletion-journal-history.js";
import { publishStateRuntimeSchemaAdmission } from "./omnipolymath-state-db-admission.js";
import { captureOmnipolymathStateIntegrityAdmission } from "./omnipolymath-state-db-cache.js";
import {
  OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS,
  OMNIPOLYMATH_STATE_SCHEMA_VERSION,
  OMNIPOLYMATH_STATE_STRICT_SCHEMA_VERSION,
} from "./omnipolymath-state-db-contract.js";
import {
  migrateCronDefaultStoreIdentity,
  resolveCronIdentityMigrationDefaultStoreKey,
} from "./omnipolymath-state-db-cron-identity-migration.js";
import { assertExistingOmnipolymathStateRuntimeSchema } from "./omnipolymath-state-db-existing-schema.js";
import {
  assertCurrentStateRuntimeSchema,
  assertNoLegacyStateRuntimeRepair,
  isOmnipolymathStateSchemaFastPathEligible,
} from "./omnipolymath-state-db-fast-path.js";
import { migrateHistoricalStateImports } from "./omnipolymath-state-db-historical-imports.js";
import type { StateDatabaseInitialization } from "./omnipolymath-state-db-initialization.js";
import { assertStateDatabaseIntegrityOnce } from "./omnipolymath-state-db-integrity-admission.js";
import {
  assertMigratedStateTableIntegrity,
  assertOmnipolymathStateDatabaseForMaintenance,
  executeCanonicalStateSchema,
  migrateBoundedStateSchema,
  omnipolymathStateMigrationAssertions,
  runStateSchemaMigrationTransaction,
  versionedStateMigrations,
  writeCurrentStateSchemaMetadata,
} from "./omnipolymath-state-db-maintenance.js";
import {
  ensureAdditiveStateColumns,
  ensureFirstUseAdditiveStateColumnsForStrictMigration,
} from "./omnipolymath-state-db-schema-additive.js";
import { tableExists } from "./omnipolymath-state-db-schema-helpers.js";
import { isExistingOmnipolymathStateSchema } from "./omnipolymath-state-db-schema-policy.js";
import {
  assertCanonicalStateSchemaShape,
  dropLegacyStateTables,
  migrateAgentDatabaseRelativePaths,
  migrateWorkerPlacementExecutionModeSchema,
  repairLegacyGatewayRestartHandoffsForStrictMigration,
} from "./omnipolymath-state-db-schema-repair.js";
import {
  createStateConfigMachineTable,
  migrateSingletonStateFoldInV12,
} from "./omnipolymath-state-db-schema-v12-foldin.js";
import { migratePredicateColumnsV21 } from "./omnipolymath-state-db-schema-v21-columns.js";
import {
  assertSupportedStateSchemaVersion,
  readStateSchemaContentVersion,
} from "./omnipolymath-state-db-schema-version.js";
import { migrateSessionWatchCursorProvenance } from "./omnipolymath-state-db-session-watch-migration.js";
import { isUninitializedNativeStartupDatabase } from "./omnipolymath-state-db-startup-checkpoint.js";
import * as retirements from "./omnipolymath-state-db-table-retirements.js";
import { describeAgentPathMigration, warnAgentPathMigration } from "./omnipolymath-state-db.paths.js";
import { getOmnipolymathDatabaseMaintenanceScope } from "./omnipolymath-state-maintenance-context.js";
import { assertOmnipolymathStateWriteAllowed } from "./omnipolymath-state-ownership.js";
import { getOmnipolymathStateRuntimeSchema } from "./omnipolymath-state-schema-compatibility.js";
import { OMNIPOLYMATH_STATE_SCHEMA_SQL } from "./omnipolymath-state-schema.js";
import { assertGatewayServiceSchemaMigrationAllowed } from "./omnipolymath-state-service-installation.js";
import { resolveSchemaMigrationIntegrityCheck } from "./schema-migration-backup-scope.js";

const stateDbLog = createSubsystemLogger("state/db");

/** Runtime converges schema; historical row repair belongs to explicit Doctor maintenance. */
export function ensureOmnipolymathStateRuntimeSchema(
  db: DatabaseSync,
  pathname: string,
  env: NodeJS.ProcessEnv,
  initialization: StateDatabaseInitialization,
  busyTimeoutMs = OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS,
  initializeNativeOnly = false,
  legacyCronDefaultStoreKey?: string,
  credentialCustody?: ClientCredentialCustody | null,
): string[] {
  // Workers borrow host generation proof, never mint a competing receipt in their isolate.
  const integrity =
    getSqliteWorkerStateIntegrityAdmission() ??
    (isMainThread ? captureOmnipolymathStateIntegrityAdmission(pathname) : undefined);
  if (isExistingOmnipolymathStateSchema(pathname, db)) {
    assertExistingOmnipolymathStateRuntimeSchema(db, pathname, integrity);
    assertOmnipolymathStateWriteAllowed({ database: db, databasePath: pathname, env });
    return [];
  }
  try {
    if (isOmnipolymathStateSchemaFastPathEligible(db, pathname, integrity)) {
      // A claim made during validation must not retain a writable handle.
      assertOmnipolymathStateWriteAllowed({ database: db, databasePath: pathname, env });
      return [];
    }
  } catch (error) {
    if (!db.isOpen || error instanceof StartupMaintenanceRequiredError) {
      throw error;
    }
    // Preserve transactional schema convergence and its diagnostics after a clean rollback.
  }

  return withStateDatabaseSchemaMaintenance({ databasePath: pathname, busyTimeoutMs }, () => {
    const now = Date.now();
    const retiredTableChanges: string[] = [];
    let runtimeReady = false;
    const applied = runStateSchemaMigrationTransaction(
      db,
      pathname,
      () => {
        assertOmnipolymathStateWriteAllowed({ database: db, databasePath: pathname, env });
        assertSupportedStateSchemaVersion(db, pathname);
        if (initializeNativeOnly && !isUninitializedNativeStartupDatabase(db)) {
          return [];
        }
        const previousVersion = readStateSchemaContentVersion(db);
        // Candidate/finalize Doctor and update repair already own offline schema
        // maintenance. Preserve the migration owner's existing access/refusal order.
        if (!getOmnipolymathDatabaseMaintenanceScope()?.ownsSchemaMaintenance) {
          assertGatewayServiceSchemaMigrationAllowed(
            pathname,
            previousVersion,
            OMNIPOLYMATH_STATE_SCHEMA_VERSION,
          );
        }
        if (previousVersion === 0 && !isUninitializedNativeStartupDatabase(db)) {
          throw new Error(
            "Unrecognized native bootstrap database; preserve it and run omnipolymath doctor --fix.",
          );
        }
        if (previousVersion > 0) {
          // Doctor-owned legacy repairs must keep their diagnostic before credential extraction.
          assertCanonicalStateSchemaShape(db, pathname);
        }
        prepareClientCredentialMigration(db, {
          path: pathname,
          env,
          fromVersion: previousVersion,
          custody: credentialCustody,
        });
        const schema = getAdmittedSqliteSchemaFacts(db);
        if (previousVersion === 0 && schema?.tables.size === 0 && schema.views.size === 0) {
          // The admitted empty catalog has no history to migrate or indexes to repair.
          createStateConfigMachineTable(db);
          executeCanonicalStateSchema(db, {
            includeVersionLazyAdditiveTables: true,
            includeAgentDeletionJournal:
              initialization.kind === "fresh" || initialization.nativeBootstrapEligible === true,
          });
          migrateCronDefaultStoreIdentity(db, {
            previousVersion,
            legacyDefaultStoreKey:
              legacyCronDefaultStoreKey ?? resolveCronIdentityMigrationDefaultStoreKey(env),
            fresh: true,
            nowMs: now,
          });
          writeCurrentStateSchemaMetadata(db, now);
          runtimeReady = true;
          return [];
        }
        if (previousVersion === OMNIPOLYMATH_STATE_SCHEMA_VERSION) {
          assertNoLegacyStateRuntimeRepair(db, pathname);
          assertStateDatabaseIntegrityOnce(db, pathname);
          const indexes = repairCanonicalSqliteIndexes(db, pathname, OMNIPOLYMATH_STATE_SCHEMA_SQL, {
            verifyPhysicalIntegrity: false,
            allowMissingColumns: true,
            validateAfterRepair: () => {
              // Index repair precedes additive-column convergence in this transaction.
              assertCanonicalStateSchemaShape(db, pathname);
              assertOmnipolymathStateDatabaseForMaintenance(db, { pathname });
            },
          });
          ensureAdditiveStateColumns(db, "runtime");
          assertCurrentStateRuntimeSchema(db, pathname);
          writeCurrentStateSchemaMetadata(db, now);
          runtimeReady = true;
          return indexes.length > 0
            ? [`Rebuilt canonical shared-state SQLite indexes (${indexes.length})`]
            : [];
        }

        omnipolymathStateMigrationAssertions.get(previousVersion)?.(db, { pathname });
        const migrationIntegrity = resolveSchemaMigrationIntegrityCheck({
          kind: "state",
          foundVersion: previousVersion,
          supportedVersion: OMNIPOLYMATH_STATE_SCHEMA_VERSION,
        });
        if (migrationIntegrity.check === "quick") {
          assertSqliteIntegrity(db, pathname, migrationIntegrity);
        } else {
          assertStateDatabaseIntegrityOnce(db, pathname);
        }
        const boundedChanges = migrateBoundedStateSchema(db, previousVersion, {
          env,
          legacyCronDefaultStoreKey,
        });
        if (boundedChanges) {
          writeCurrentStateSchemaMetadata(db, now);
          assertCurrentStateRuntimeSchema(db, pathname);
          assertMigratedStateTableIntegrity(db, pathname, previousVersion);
          runtimeReady = true;
          return boundedChanges;
        }

        // Bounded selection can defer for unrelated additive columns; consume the
        // historical shape before the full runner publishes its newer marker too.
        const historicalChanges = migrateHistoricalStateImports(db, previousVersion);
        const includeAgentDeletionJournal =
          tableExists(db, "agent_deletion_journal") ||
          hasPreJournalStateSchema(db) ||
          ((initialization.kind === "fresh" || initialization.nativeBootstrapEligible === true) &&
            isUninitializedNativeStartupDatabase(db));
        // Older schemas still need atomic content transforms before retiring their columns.
        dropLegacyStateTables(db);
        const changes = retirements.runRetiredStateTableMigrations(db, previousVersion);
        retiredTableChanges.push(...changes);
        if (migrateSingletonStateFoldInV12(db, previousVersion)) {
          changes.push("Folded singleton state tables into config_machine_state (v12)");
        }
        if (migrateWorkerPlacementExecutionModeSchema(db, previousVersion)) {
          changes.push("Migrated cloud worker placements to execution modes");
        }
        const pathMigration = migrateAgentDatabaseRelativePaths(db, previousVersion, pathname);
        changes.push(...describeAgentPathMigration(pathMigration));
        // Historical delivery repair below already writes and reads the promoted columns.
        if (migratePredicateColumnsV21(db, previousVersion)) {
          changes.push(
            "Derived meeting transcript selectors and bounded delivery retention columns (v21)",
          );
        }
        // v21 only derives predicates; don't replay legacy payload repair on v20 rows.
        ensureAdditiveStateColumns(db, previousVersion < 20 ? "repair" : "runtime");
        for (const migration of versionedStateMigrations) {
          if (migration.migrate(db, previousVersion, { env, legacyCronDefaultStoreKey })) {
            changes.push(migration.applied);
          }
        }
        migrateSessionWatchCursorProvenance(db);
        assertCanonicalStateSchemaShape(db, pathname);
        executeCanonicalStateSchema(db, {
          includeVersionLazyAdditiveTables: true,
          includeAgentDeletionJournal,
        });
        migrateLegacyCronRunLogsToTaskRuns(db);
        if (
          previousVersion < OMNIPOLYMATH_STATE_STRICT_SCHEMA_VERSION &&
          hasNonStrictSqliteTables(db)
        ) {
          repairLegacyGatewayRestartHandoffsForStrictMigration(db);
          ensureFirstUseAdditiveStateColumnsForStrictMigration(db);
          const strict = migrateSqliteSchemaToStrictInTransaction(
            db,
            getOmnipolymathStateRuntimeSchema({
              includeVersionLazyAdditiveTables: true,
              includeAgentDeletionJournal,
            }),
            { databaseLabel: pathname },
          );
          if (strict.migratedTables.length > 0) {
            changes.push(
              `Migrated shared state tables to SQLite STRICT typing (${strict.migratedTables.length})`,
            );
          }
        }
        repairCanonicalSqliteIndexes(db, pathname, OMNIPOLYMATH_STATE_SCHEMA_SQL, {
          verifyPhysicalIntegrity: false,
        });
        writeCurrentStateSchemaMetadata(db, now);
        assertOmnipolymathStateDatabaseForMaintenance(db, { pathname });
        assertMigratedStateTableIntegrity(db, pathname, previousVersion, true);
        runtimeReady = true;
        warnAgentPathMigration(stateDbLog, pathMigration, pathname);
        return [...historicalChanges, ...changes];
      },
      { busyTimeoutMs, databaseLabel: pathname, operationLabel: "state.schema.ensure" },
    );
    if (runtimeReady) {
      publishStateRuntimeSchemaAdmission(db, true);
    }
    retiredTableChanges.forEach(retirements.logRetiredStateTableMigration);
    return applied;
  });
}
