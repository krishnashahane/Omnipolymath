import path from "node:path";
import { isMainThread } from "node:worker_threads";
import { resolveStateDir } from "../config/paths.js";
import { assertEngineStoreExecutionAllowed } from "../infra/database-engine/admission-scope.js";
import { isGatewayExternallySupervised } from "../infra/gateway-supervision.js";
import { enableNodeSqliteKyselyStatementCache } from "../infra/kysely-sync.js";
import {
  openNodeSqliteDatabase,
  resolveExistingSqliteFileUri,
  supportsNodeSqliteExtensionLoading,
} from "../infra/node-sqlite.js";
import { registerProcessExitCleanup } from "../infra/process-exit-cleanup.js";
import {
  isPostgresSqlConnection,
  sqlPublicationAnchor,
  type EngineConnection,
} from "../infra/sql-connection.js";
import {
  readSqliteDatabaseIntegrityVerification,
  readSqliteDatabaseCleanCloseRefusal,
} from "../infra/sqlite-database-admission.js";
import { quarantineOrphanedSqliteSidecars } from "../infra/sqlite-files.js";
import {
  isTerminalSqliteIntegrityError,
  type SqliteIntegrityDiagnostics,
  type SqliteIntegrityOperation,
} from "../infra/sqlite-integrity.js";
import { admitSqliteSchema } from "../infra/sqlite-schema-facts.js";
import {
  isSqliteSchemaVersionError,
  readSqliteWriterAppVersion,
} from "../infra/sqlite-user-version.js";
import { prepareSqliteDatabaseDirectory } from "../infra/sqlite-wal-filesystem.js";
import { createSqliteWalReclamationResult } from "../infra/sqlite-wal-reclamation.js";
import {
  configureSqliteConnectionPragmas,
  configureSqlitePreSchemaPragmas,
  type SqliteWalMaintenance,
} from "../infra/sqlite-wal.js";
import { SqliteWorkerOpenRefusedError } from "../infra/sqlite-worker-contract.js";
import { assertExistingDatabaseIdentity } from "../infra/sqlite-worker-identity.js";
import { requestSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { VERSION } from "../version.js";
import {
  assertAgentCreationClaimCurrent,
  registerAgentCreationClaimHandle,
  reserveAgentCreationClaimAdmission,
} from "./agent-creation-claim.js";
import { assertAgentDatabaseAdmitted } from "./agent-database-admission.js";
import {
  getAgentDeletionDatabaseCleanup,
  registerAgentDeletionDatabaseCleanup,
} from "./agent-deletion-cleanup.js";
import { assertCanonicalSessionValidationSchema } from "./omnipolymath-agent-canonical-validation-schema.js";
import { createOmnipolymathAgentDatabaseAdmissionOwner } from "./omnipolymath-agent-db-admission.js";
import {
  getOmnipolymathAgentDatabaseIfOpen,
  retainAgentDatabase,
} from "./omnipolymath-agent-db-borrower.js";
import type {
  OmnipolymathAgentDatabase,
  OmnipolymathAgentDatabaseOptions,
  OmnipolymathAgentDatabaseRegistrationObserver,
  OmnipolymathAgentDatabaseRepairAdmission,
} from "./omnipolymath-agent-db-contract.js";
import { agentEngineInput, openAgentEngineStore } from "./omnipolymath-agent-db-engine.js";
import {
  assertOmnipolymathAgentDatabaseIdentity,
  registerOmnipolymathAgentDatabaseIdentity,
} from "./omnipolymath-agent-db-identity.js";
import { readAgentDatabaseLeaseProvenance } from "./omnipolymath-agent-db-lease-provenance.js";
import {
  hasAgentDatabaseMaintenanceAuthority,
  assertOmnipolymathAgentDatabaseLease,
  claimOmnipolymathAgentDatabaseLease,
  recordOmnipolymathAgentDatabaseAdmission,
  releaseOmnipolymathAgentDatabaseLease,
  type OmnipolymathAgentIntegrityVerificationReceiver,
  type prepareOmnipolymathAgentDatabaseWorkerLease,
} from "./omnipolymath-agent-db-lease.js";
import {
  agentDatabaseLifecycle as cache,
  startAgentDatabaseOpenTiming,
  recordOmnipolymathAgentDatabaseOpenFailure,
  closeCachedOmnipolymathAgentDatabase,
  createAgentDatabaseScopeOwnedClose,
  closeMaintenanceAgentDatabase,
  closeOmnipolymathAgentDatabaseByPathAsync,
  closeOmnipolymathAgentDatabases,
  refreshAgentDatabaseIdleTimer,
  registerAgentDatabaseHandle,
  retainFailedAgentDatabaseClose,
  revokePendingAgentDatabaseOpen,
  type PendingAgentDatabaseOpen,
} from "./omnipolymath-agent-db-lifecycle.js";
import { ensureOmnipolymathAgentDatabasePermissions } from "./omnipolymath-agent-db-permissions.js";
import { closeIdleOmnipolymathAgentDatabaseReadOnly } from "./omnipolymath-agent-db-readonly-scope.js";
import { hasRegisteredOmnipolymathAgentDatabasePath } from "./omnipolymath-agent-db-registry-listing.js";
import { registerOmnipolymathAgentDatabase } from "./omnipolymath-agent-db-registry.js";
import {
  assertAgentDatabaseResourceAdmission,
  matchesAgentDatabaseReadCandidatePath,
  type OmnipolymathAgentDatabaseReadCandidateResource,
} from "./omnipolymath-agent-db-resources.js";
import {
  assertCanonicalAgentPersistenceVersion,
  assertCurrentAgentSchemaMetadata,
  assertExistingAgentSchemaOwner,
  assertSupportedAgentSchemaVersion,
  readExistingAgentSchemaMeta,
} from "./omnipolymath-agent-db-schema-helpers.js";
import {
  agentDatabaseIntegrityBeforeMutationSteps,
  ensureOmnipolymathAgentSchema,
} from "./omnipolymath-agent-db-schema.js";
import { revalidateAgentDatabaseTerminalOpen } from "./omnipolymath-agent-db-terminal.js";
import {
  adoptOmnipolymathAgentDatabaseValidation,
  adoptOmnipolymathAgentDatabaseSchema,
  getOmnipolymathAgentDatabaseValidation,
  invalidateOmnipolymathAgentDatabaseValidation,
  publishOmnipolymathAgentDatabaseSchema,
  hasRevokedOmnipolymathAgentDatabaseValidation,
  setOmnipolymathAgentDatabaseValidation,
} from "./omnipolymath-agent-db-validation-cache.js";
import { resolveOmnipolymathAgentSqlitePath } from "./omnipolymath-agent-db.paths.js";
import { registerOmnipolymathAgentWalMaintenance } from "./omnipolymath-agent-db.wal.js";
import {
  clearOmnipolymathDatabaseQuarantine,
  readOmnipolymathDatabaseQuarantineFailure,
} from "./omnipolymath-quarantine-store.js";
import { getOmnipolymathDatabaseMaintenanceScope } from "./omnipolymath-state-db-async-lifecycle.js";
import type { OmnipolymathStateDatabaseOptions } from "./omnipolymath-state-db-contract.js";
import { OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS } from "./omnipolymath-state-db.js";
import { resolveOmnipolymathStateSqlitePath } from "./omnipolymath-state-db.paths.js";

export {
  OMNIPOLYMATH_AGENT_SCHEMA_VERSION,
  type OmnipolymathAgentDatabase,
  type OmnipolymathAgentDatabaseOptions,
} from "./omnipolymath-agent-db-contract.js";
export { deferOmnipolymathAgentPostCommitPublication } from "./omnipolymath-agent-db-lifecycle.js";
export {
  listOmnipolymathRegisteredAgentDatabases,
  readOmnipolymathAgentDatabaseRegistryToken,
} from "./omnipolymath-agent-db-registry.js";
export { ensureOmnipolymathAgentDatabaseSchema } from "./omnipolymath-agent-db-schema.js";
export {
  isIncognitoOmnipolymathAgentSqlitePath,
  resolveIncognitoOmnipolymathAgentSqlitePath,
  resolveOmnipolymathAgentSqlitePath,
} from "./omnipolymath-agent-db.paths.js";

/**
 * Clear a terminal open failure after doctor rewrites the database file.
 * Returns false when the persisted quarantine row survived; callers must
 * surface that, or the next open re-quarantines the repaired file.
 */
export function clearOmnipolymathAgentDatabaseOpenFailure(
  pathname: string,
  options: OmnipolymathStateDatabaseOptions = {},
): boolean {
  const resolvedPath = path.resolve(pathname);
  const cleared = clearOmnipolymathDatabaseQuarantine(resolvedPath, { env: options.env });
  cache.terminal.clear(resolvedPath);
  return cleared;
}

export type { OmnipolymathAgentDatabaseWriteAdmission } from "./omnipolymath-agent-db-admission.js";
export const {
  openOmnipolymathAgentDatabase,
  openOmnipolymathAgentDatabaseInWorker,
  runOmnipolymathAgentWriteTransaction,
  withOmnipolymathAgentDatabaseAsync,
  withOmnipolymathAgentDatabaseRuntime,
  withOmnipolymathAgentDatabaseRuntimeFromExecution,
  withOmnipolymathAgentDatabaseAdmission,
} = createOmnipolymathAgentDatabaseAdmissionOwner(openOmnipolymathAgentDatabaseSteps);

function* openOmnipolymathAgentDatabaseSteps(
  options: OmnipolymathAgentDatabaseOptions,
  pending?: PendingAgentDatabaseOpen,
  preparedLease?: ReturnType<typeof prepareOmnipolymathAgentDatabaseWorkerLease>,
  registrationObserver?: OmnipolymathAgentDatabaseRegistrationObserver,
  repairAdmission?: OmnipolymathAgentDatabaseRepairAdmission,
): SqliteIntegrityOperation<OmnipolymathAgentDatabase> {
  const engineInput = agentEngineInput();
  const integrityCheck = engineInput
    ? undefined
    : (repairAdmission?.integrityCheck ??
      getOmnipolymathDatabaseMaintenanceScope()?.sqliteIntegrityCheck);
  if (engineInput) {
    assertEngineStoreExecutionAllowed();
  }
  const agentId = normalizeAgentId(options.agentId);
  assertAgentDatabaseAdmitted(agentId, { env: options.env });
  const databaseOptions = { ...options, agentId };
  const pathname = resolveOmnipolymathAgentSqlitePath(databaseOptions);
  const assertCurrent = (database?: Pick<OmnipolymathAgentDatabase, "db" | "path">) => {
    repairAdmission?.assertCurrent?.();
    if (repairAdmission?.expectedIdentity) {
      if (database) {
        assertOmnipolymathAgentDatabaseIdentity(database, repairAdmission.expectedIdentity);
      } else {
        assertExistingDatabaseIdentity(
          pathname,
          repairAdmission.expectedIdentity.key,
          repairAdmission.expectedIdentity.birthtime,
        );
      }
    }
  };
  assertCurrent();
  assertAgentCreationClaimCurrent(databaseOptions);
  getAgentDeletionDatabaseCleanup(databaseOptions)?.assertCurrent();
  // A live successful cache entry is authoritative; failed entries remain only for disposal.
  const opened = getOmnipolymathAgentDatabaseIfOpen(databaseOptions);
  if (opened) {
    assertCurrent(opened);
    if (preparedLease) {
      throw new Error("A prepared Worker lease cannot adopt an existing agent database handle");
    }
    if (pending?.workerPrepared) {
      adoptOmnipolymathAgentDatabaseSchema(opened, true, true);
    }
    return opened;
  }
  assertAgentDatabaseResourceAdmission({ agentId, path: pathname });
  if (!pending) {
    revokePendingAgentDatabaseOpen(pathname);
  }
  const cached = cache.databases.get(pathname);
  const allowExtension = !process.permission && supportsNodeSqliteExtensionLoading();
  if (!repairAdmission?.expectedIdentity) {
    quarantineOrphanedSqliteSidecars(pathname);
  }
  // Latched paths are quarantined; every fresh open fails fast here until
  // doctor repairs the file and clears the latch plus the persisted row.
  revalidateAgentDatabaseTerminalOpen(pathname);
  const persistedFailure = readOmnipolymathDatabaseQuarantineFailure("agent", pathname, {
    env: databaseOptions.env,
  });
  if (persistedFailure) {
    recordOmnipolymathAgentDatabaseOpenFailure(pathname, persistedFailure);
    throw persistedFailure;
  }
  if (cached) {
    // A closed handle can leave Kysely and WAL helpers cached; clear both before reopening.
    closeCachedOmnipolymathAgentDatabase(cached);
    cache.databases.delete(pathname);
    cache.failures.delete(pathname);
  }
  // Lease release must retain its original state owner after ambient env changes.
  const leaseEnvironment = {
    ...(options.env ?? process.env),
    OMNIPOLYMATH_STATE_DIR: resolveStateDir(options.env ?? process.env),
    ...(isGatewayExternallySupervised(options.env ?? process.env)
      ? { OMNIPOLYMATH_SUPERVISOR_MODE: "external" }
      : {}),
  };
  if (
    preparedLease &&
    (preparedLease.receipt.agentId !== agentId || preparedLease.receipt.path !== pathname)
  ) {
    throw new Error("Prepared agent database lease belongs to another store");
  }
  let reuseIntegrity = false;
  let liveOwnerProvenance: string | undefined;
  const diagnostics: SqliteIntegrityDiagnostics = {};
  const validation = pending?.validation ?? preparedLease?.validation;
  const captureVerification: OmnipolymathAgentIntegrityVerificationReceiver = (
    runtimeIntegrityAllowed,
    admittedFileProvenance,
  ) => {
    reuseIntegrity = runtimeIntegrityAllowed;
    liveOwnerProvenance = admittedFileProvenance;
  };
  const releaseOptions = { env: leaseEnvironment, initializationAgentPaths: [pathname] };
  assertCurrent();
  const leaseId = preparedLease
    ? preparedLease.claim(captureVerification)
    : claimOmnipolymathAgentDatabaseLease(
        { agentId, path: pathname, env: leaseEnvironment },
        undefined,
        captureVerification,
      );
  if (pending) {
    pending.assertHeld = () =>
      assertOmnipolymathAgentDatabaseLease(leaseId, {
        agentId,
        path: pathname,
        env: leaseEnvironment,
      });
  }
  const finishPhase = startAgentDatabaseOpenTiming(
    agentId,
    pathname,
    pending ? "async" : "sync",
    diagnostics,
  );
  let openedDb: EngineConnection | undefined;
  let openedDatabase: OmnipolymathAgentDatabase | undefined;
  let openedWalMaintenance: SqliteWalMaintenance | undefined;
  let releaseCreationAdmission: (() => void) | undefined;
  try {
    assertCurrent();
    if (preparedLease && !isMainThread) {
      try {
        // Capture proof after stale-lease cleanup, but refuse before opening a native writer.
        requestSqliteWorkerOperationAdmission({
          stage: "prepare",
          facts: { kind: "agent-validation-start", lease: preparedLease.receipt },
        });
      } catch (error) {
        throw new SqliteWorkerOpenRefusedError(error);
      }
    }
    if (!repairAdmission?.expectedIdentity) {
      ensureOmnipolymathAgentDatabasePermissions(pathname, databaseOptions);
      prepareSqliteDatabaseDirectory(pathname);
    }
    closeIdleOmnipolymathAgentDatabaseReadOnly(pathname);
    // Ordinary agent state also works with SQLite builds that omit extensions.
    // Trusted borrowers may enable them only when both the runtime and permissions allow it.
    const db = openNodeSqliteDatabase(
      repairAdmission?.expectedIdentity ? resolveExistingSqliteFileUri(pathname) : pathname,
      { allowExtension, timeout: engineInput ? undefined : OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS },
    );
    openedDb = db;
    let selected: EngineConnection = db;
    registerOmnipolymathAgentDatabaseIdentity(db, resolveOmnipolymathStateSqlitePath(leaseEnvironment));
    assertCurrent({ db, path: pathname });
    if (repairAdmission?.expectedIdentity) {
      ensureOmnipolymathAgentDatabasePermissions(pathname, databaseOptions);
    }
    db.enableLoadExtension(false);
    enableNodeSqliteKyselyStatementCache(db);
    if (preparedLease) {
      // Worker TEMP policy precedes schema/session caches and any exposed connection.
      db.exec("PRAGMA temp_store = FILE");
    }
    finishPhase("open");
    // Physical admission survives idle connection retirement for the process lifetime.
    const validationDatabase = { db, path: pathname, agentId };
    if (validation && !engineInput) {
      adoptOmnipolymathAgentDatabaseValidation(validationDatabase, validation);
    }
    let isValidatedReopen = Boolean(getOmnipolymathAgentDatabaseValidation(validationDatabase));
    // Lease history governs first admission; it cannot expire this process's checked file.
    const reuseAdmittedIntegrity =
      reuseIntegrity || (pending?.workerPrepared === true && pending.integrityRevoked !== true);
    let reusedSchema = false;
    let walMaintenance: SqliteWalMaintenance;
    try {
      if (engineInput) {
        if (pending) {
          releaseCreationAdmission = reserveAgentCreationClaimAdmission(
            pending,
            databaseOptions,
            async () => {
              await closeOmnipolymathAgentDatabaseByPathAsync(pathname, agentId);
            },
          );
        }
        selected = openAgentEngineStore(db, agentId, pathname, false, (connection, error) => {
          selected = openedDb = connection;
          throw error;
        });
        openedDb = selected;
        walMaintenance = {
          checkpoint: () => false,
          stop: async () => {},
          reclaimFreePages: createSqliteWalReclamationResult,
          close: () => true,
        };
        setOmnipolymathAgentDatabaseValidation({ db: selected, path: pathname, agentId });
        isValidatedReopen = true;
        reusedSchema = true;
      } else {
        reusedSchema = adoptOmnipolymathAgentDatabaseSchema(
          validationDatabase,
          reuseAdmittedIntegrity,
          pending?.workerPrepared,
        );
        if (!reusedSchema) {
          admitSqliteSchema(db, (userVersion) => {
            assertSupportedAgentSchemaVersion(db, pathname, userVersion);
          });
        }
        const existingSchema = readExistingAgentSchemaMeta(db);
        assertExistingAgentSchemaOwner(existingSchema, agentId, pathname);
        if (reusedSchema) {
          assertCurrentAgentSchemaMetadata(existingSchema, agentId, pathname);
        }
        if (pending) {
          releaseCreationAdmission = reserveAgentCreationClaimAdmission(
            pending,
            databaseOptions,
            async () => {
              await closeOmnipolymathAgentDatabaseByPathAsync(pathname, agentId);
            },
          );
        }
        // The host grant can revoke transferred proof; decide reuse after it returns.
        diagnostics.integrityGateReason =
          preparedLease?.integrityRevoked === true ||
          pending?.integrityRevoked === true ||
          hasRevokedOmnipolymathAgentDatabaseValidation(pathname, validation)
            ? "revoked"
            : reuseIntegrity
              ? (readSqliteDatabaseCleanCloseRefusal(db) ?? "no-proof")
              : "lease-class";
        let verification: { verifiedAt: number } | undefined;
        if (diagnostics.integrityGateReason === "revoked") {
          isValidatedReopen = false;
          reusedSchema = false;
        } else if (reuseIntegrity) {
          // Path admission can precede replacement detection; borrow only this native file's proof.
          verification = readSqliteDatabaseIntegrityVerification(db);
        }
        const requiresCurrentVersionConvergence = yield* agentDatabaseIntegrityBeforeMutationSteps(
          db,
          agentId,
          pathname,
          {
            runtimeAdmission: !preparedLease?.startupIntegrityRequired,
            diagnostics,
            verification,
            reuseRuntimeIntegrity:
              (isValidatedReopen && reuseAdmittedIntegrity) ||
              (diagnostics.integrityGateReason === "lease-class" &&
                liveOwnerProvenance !== undefined &&
                // Re-read after the native open: the claim's file must be the one this handle opened.
                readAgentDatabaseLeaseProvenance(pathname) === liveOwnerProvenance),
            admittedSchema: reusedSchema,
            integrityCheck,
            integrityTables: repairAdmission?.integrityTables ?? [],
          },
        );
        assertCurrent(validationDatabase);
        if (!diagnostics.integrityGateOutcome || diagnostics.integrityGateOutcome === "cached") {
          delete diagnostics.integrityGateReason;
        }
        if (isValidatedReopen && (!existingSchema || requiresCurrentVersionConvergence)) {
          // New files and same-version divergence cannot inherit an earlier validation.
          // The existing full path initializes or converges them before exposure.
          invalidateOmnipolymathAgentDatabaseValidation(pathname);
          isValidatedReopen = false;
        }
        assertCanonicalAgentPersistenceVersion(db, pathname);
        finishPhase("validation");
        configureSqlitePreSchemaPragmas(db, {
          busyTimeoutMs: OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS,
        });
        walMaintenance = configureSqliteConnectionPragmas(db, {
          busyTimeoutMs: OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS,
          // Native workers already checkpoint on maintenance ticks, outside foreground commits.
          autoCheckpointPages: 0,
          databaseLabel: `omnipolymath-agent:${agentId}`,
          databasePath: pathname,
          foreignKeys: true,
          synchronous: "NORMAL",
        });
        openedWalMaintenance = walMaintenance;
        finishPhase("configuration");
        assertCurrent(validationDatabase);
        if (
          !existingSchema ||
          requiresCurrentVersionConvergence ||
          (!isValidatedReopen && readSqliteWriterAppVersion(db) !== VERSION)
        ) {
          ensureOmnipolymathAgentSchema(
            db,
            agentId,
            pathname,
            undefined,
            undefined,
            undefined,
            false,
            integrityCheck,
          );
        }
        finishPhase("schema");
        selected = openAgentEngineStore(db, agentId, pathname);
      }
    } catch (err) {
      if (diagnostics.integrityGateOutcome === "failed") {
        finishPhase("validation");
      }
      openedWalMaintenance?.close();
      if (selected.isOpen) {
        selected.close();
      }
      if (isPostgresSqlConnection(selected) && db.isOpen) {
        db.close();
      }
      const current = cache.databases.get(pathname);
      if (!current || current.db === db) {
        invalidateOmnipolymathAgentDatabaseValidation(pathname);
      }
      if (
        err instanceof Error &&
        (isSqliteSchemaVersionError(err) || isTerminalSqliteIntegrityError(err))
      ) {
        recordOmnipolymathAgentDatabaseOpenFailure(pathname, err);
      }
      throw err;
    }
    assertCurrent({ db: selected, path: pathname });
    ensureOmnipolymathAgentDatabasePermissions(pathname, databaseOptions);
    if (!reusedSchema) {
      admitSqliteSchema(db);
      assertCanonicalSessionValidationSchema(db);
    }
    const database = { agentId, db: selected, path: pathname, walMaintenance };
    openedDatabase = database;
    if (hasAgentDatabaseMaintenanceAuthority()) {
      throw new Error(
        "Agent database maintenance is in progress; retry after omnipolymath doctor --fix completes.",
      );
    }
    registerAgentDeletionDatabaseCleanup(database, databaseOptions)?.registerClose(
      createAgentDatabaseScopeOwnedClose(database, "Agent deletion cleanup"),
    );
    registerAgentCreationClaimHandle(database, databaseOptions)?.registerClose(
      createAgentDatabaseScopeOwnedClose(database, "Agent creation claim"),
    );
    if (
      !isValidatedReopen ||
      !hasRegisteredOmnipolymathAgentDatabasePath(database, { env: options.env })
    ) {
      assertCurrent(database);
      registerOmnipolymathAgentDatabase(
        {
          agentId,
          path: pathname,
          env: options.env,
          // Bounded admission retains process proof without minting a FULL receipt or seal.
          // Temporary QUICK repair handles still cannot publish runtime admission.
          admittedDb:
            integrityCheck === "quick" && diagnostics.integrityGateOutcome !== "pending"
              ? undefined
              : selected,
        },
        registrationObserver,
      );
    } else if (!reusedSchema) {
      publishOmnipolymathAgentDatabaseSchema(database);
    }
    cache.terminal.clear(pathname);
    // Safety net for processes that end without an orderly close: agent DBs have
    // no shutdown owner like the ACP/gateway state DB closes. Closing unregisters.
    cache.unregisterExitClose ??= registerProcessExitCleanup(closeOmnipolymathAgentDatabases);
    finishPhase("registration");
    registerAgentDatabaseHandle(database, leaseId, leaseEnvironment);
    assertCurrent(database);
    recordOmnipolymathAgentDatabaseAdmission(leaseId, {
      agentId,
      path: pathname,
      env: leaseEnvironment,
    });
    refreshAgentDatabaseIdleTimer(database);
    if (isMainThread) {
      registerOmnipolymathAgentWalMaintenance(database, leaseEnvironment);
    }
    getOmnipolymathDatabaseMaintenanceScope()?.own(database.db, "agent-handles", () =>
      closeMaintenanceAgentDatabase(database),
    );
    releaseCreationAdmission?.();
    return database;
  } catch (error) {
    // The host releases a refused prepared worker's lease after native exit.
    const deferLeaseRelease =
      preparedLease !== undefined && !isMainThread && error instanceof SqliteWorkerOpenRefusedError;
    let closeError: unknown;
    if (openedDatabase) {
      try {
        closeCachedOmnipolymathAgentDatabase(openedDatabase);
      } catch (caught) {
        closeError = caught;
      }
    }
    if (openedDb && (openedDb.isOpen || sqlPublicationAnchor(openedDb).isOpen)) {
      const successor = cache.databases.get(pathname);
      if (pending && successor && successor.db !== openedDb) {
        // A synchronous opener may supersede pending work. Retain failed cleanup
        // with its original native owner; never overwrite the replacement cache/lease.
        const retainedDb = openedDb;
        retainFailedAgentDatabaseClose(agentId, pathname, () => {
          openedWalMaintenance?.close();
          if (retainedDb.isOpen) {
            retainedDb.close();
          }
          const anchor = sqlPublicationAnchor(retainedDb);
          if (isPostgresSqlConnection(retainedDb) && anchor.isOpen) {
            anchor.close();
          }
          releaseOmnipolymathAgentDatabaseLease(leaseId, releaseOptions);
        });
        throw error;
      }
      invalidateOmnipolymathAgentDatabaseValidation(pathname);
      const retainedDatabase =
        openedDatabase ??
        ({
          agentId,
          db: openedDb,
          path: pathname,
          walMaintenance: openedWalMaintenance ?? {
            checkpoint: () => false,
            stop: async () => {},
            reclaimFreePages: createSqliteWalReclamationResult,
            close: () => false,
          },
        } satisfies OmnipolymathAgentDatabase);
      // Failed opens remain disposal-owned but cannot become successful cache hits.
      cache.databases.set(pathname, retainedDatabase);
      refreshAgentDatabaseIdleTimer(retainedDatabase);
      cache.leases.set(pathname, { leaseId, env: leaseEnvironment });
      cache.failures.set(pathname, closeError ?? error);
      getOmnipolymathDatabaseMaintenanceScope()?.own(retainedDatabase.db, "agent-handles", () =>
        closeMaintenanceAgentDatabase(retainedDatabase),
      );
      cache.unregisterExitClose ??= registerProcessExitCleanup(closeOmnipolymathAgentDatabases);
    } else if (!deferLeaseRelease) {
      const closeOutcome = error instanceof SqliteWorkerOpenRefusedError ? "read-only" : undefined;
      try {
        releaseOmnipolymathAgentDatabaseLease(leaseId, releaseOptions, closeOutcome);
      } catch (releaseError) {
        retainFailedAgentDatabaseClose(agentId, pathname, () =>
          releaseOmnipolymathAgentDatabaseLease(leaseId, releaseOptions, closeOutcome),
        );
        throw releaseError;
      }
    }
    throw closeError ?? error;
  }
}

/** Retain the exact verified connection across awaits; explicit disposal still revokes it. */
export function borrowOmnipolymathAgentDatabase(options: OmnipolymathAgentDatabaseOptions): {
  db: EngineConnection;
  release: () => void;
} {
  const { db } = openOmnipolymathAgentDatabase(options);
  return { db, release: retainAgentDatabase(db) };
}

export function isOmnipolymathAgentDatabaseOpen(pathname: string): boolean {
  return cache.databases.get(path.resolve(pathname))?.db.isOpen === true;
}

/** Pin only admitted native readers already present in captured discovery families. */
export function retainOmnipolymathAgentDatabaseReadCandidates(
  candidates: readonly Pick<OmnipolymathAgentDatabaseReadCandidateResource, "path" | "scope">[],
  env: NodeJS.ProcessEnv,
): { databases: readonly OmnipolymathAgentDatabase[]; release: () => void } {
  const retained: Array<{ database: OmnipolymathAgentDatabase; release: () => void }> = [];
  const release = () => {
    for (const reader of retained.toReversed()) {
      reader.release();
    }
  };
  try {
    for (const database of cache.databases.values()) {
      if (
        !database.db.isOpen ||
        database.db.isTransaction ||
        !candidates.some((candidate) =>
          matchesAgentDatabaseReadCandidatePath(candidate, database.path),
        )
      ) {
        continue;
      }
      let admitted: OmnipolymathAgentDatabase | undefined;
      try {
        admitted = getOmnipolymathAgentDatabaseIfOpen({
          agentId: database.agentId,
          path: database.path,
          env,
        });
      } catch {
        // A refused cached writer cannot supply a read continuation. Fresh reads
        // retain the existing independent read-only schema and ownership checks.
        continue;
      }
      if (admitted === database) {
        retained.push({ database, release: retainAgentDatabase(database.db) });
      }
    }
    return { databases: retained.map(({ database }) => database), release };
  } catch (error) {
    release();
    throw error;
  }
}

export {
  closeOmnipolymathAgentDatabaseByPath,
  closeOmnipolymathAgentDatabaseByPathAsync,
  closeOmnipolymathAgentDatabasesForTest,
  closeOmnipolymathAgentDatabasesAsync,
  settleOmnipolymathAgentDatabaseWorkerClose,
} from "./omnipolymath-agent-db-lifecycle.js";

export { getOmnipolymathAgentDatabaseIfOpen } from "./omnipolymath-agent-db-borrower.js";
export { inspectOmnipolymathAgentDatabaseOwner } from "./omnipolymath-agent-db-owner-read.js";
