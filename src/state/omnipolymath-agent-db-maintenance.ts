import type { DatabaseSync } from "node:sqlite";
import {
  clearNodeSqliteKyselyCacheForDatabase,
  enableNodeSqliteKyselyStatementCache,
} from "../infra/kysely-sync.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { repairDoctorSqliteIndexCorruptionAsync } from "../infra/sqlite-index-recovery.js";
import { runSqliteIntegrityOperationInWorker } from "../infra/sqlite-integrity-operation.js";
import { configureSqliteMaintenanceCache } from "../infra/sqlite-maintenance-cache.js";
import { invalidateSqliteSchemaFacts } from "../infra/sqlite-schema-facts.js";
import { SqliteSchemaMismatchError } from "../infra/sqlite-schema-issues.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { getAgentDeletionDatabaseCleanup } from "./agent-deletion-cleanup.js";
import {
  AGENT_MEDIA_SCHEMA_VERSION,
  OMNIPOLYMATH_AGENT_SCHEMA_VERSION,
} from "./omnipolymath-agent-db-contract.js";
import { invalidateOmnipolymathAgentDatabaseIntegrityBeforeMutation } from "./omnipolymath-agent-db-lease.js";
import { assertAgentDatabaseMaintenanceAuthority } from "./omnipolymath-agent-db-maintenance-authority.js";
import {
  assertExistingAgentSchemaOwner,
  assertOmnipolymathAgentSchemaContains,
  assertSupportedAgentSchemaVersion,
  readExistingAgentSchemaMeta,
} from "./omnipolymath-agent-db-schema-helpers.js";
import { ensureOmnipolymathAgentDatabaseSchemaSteps } from "./omnipolymath-agent-db-schema.js";
import { AGENT_FTS_SCHEMAS } from "./omnipolymath-agent-fts-schema.js";
import { OMNIPOLYMATH_AGENT_SCHEMA_SQL } from "./omnipolymath-agent-schema.js";
import { OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS } from "./omnipolymath-state-db.js";
import type { OmnipolymathStateLeaseContext } from "./omnipolymath-state-lease.js";

const agentDbLog = createSubsystemLogger("state/agent-db");

/** Require exact agent ownership without requiring the latest schema. */
export function assertOmnipolymathAgentDatabaseOwner(
  database: DatabaseSync,
  options: { agentId: string; pathname: string },
): NonNullable<ReturnType<typeof readExistingAgentSchemaMeta>> {
  // Explicit maintenance inspects the current file, including external damage after admission.
  invalidateSqliteSchemaFacts(database);
  const agentId = normalizeAgentId(options.agentId);
  const metadata = readExistingAgentSchemaMeta(database);
  if (!metadata) {
    throw new SqliteSchemaMismatchError(
      `Omnipolymath agent database ${options.pathname} has no schema ownership metadata. Run omnipolymath doctor --fix to inspect and repair its ownership.`,
    );
  }
  assertExistingAgentSchemaOwner(metadata, agentId, options.pathname);
  if (metadata.agentId !== agentId) {
    throw new SqliteSchemaMismatchError(
      `Omnipolymath agent database ${options.pathname} belongs to agent ${metadata.agentId}; requested agent ${agentId}.`,
    );
  }
  return metadata;
}

/** Require the exact agent owner and schema before offline file maintenance. */
export function assertOmnipolymathAgentDatabaseForMaintenance(
  database: DatabaseSync,
  options: { agentId: string; pathname: string; allowStartupIndexRepair?: boolean },
): boolean {
  const metadata = assertOmnipolymathAgentDatabaseOwner(database, options);

  const userVersion = assertSupportedAgentSchemaVersion(database, options.pathname);
  if (userVersion !== OMNIPOLYMATH_AGENT_SCHEMA_VERSION) {
    throw new SqliteSchemaMismatchError(
      `Omnipolymath agent database ${options.pathname} uses schema version ${userVersion}; run omnipolymath doctor --fix before compacting it.`,
    );
  }
  if (metadata.schemaVersion !== OMNIPOLYMATH_AGENT_SCHEMA_VERSION) {
    throw new SqliteSchemaMismatchError(
      `Omnipolymath agent database ${options.pathname} metadata schema version ${metadata.schemaVersion ?? "invalid"} does not match ${OMNIPOLYMATH_AGENT_SCHEMA_VERSION}; run omnipolymath doctor --fix before compacting it.`,
    );
  }
  return assertOmnipolymathAgentSchemaContains(
    database,
    options.pathname,
    OMNIPOLYMATH_AGENT_SCHEMA_SQL,
    "current",
    options.allowStartupIndexRepair,
  );
}

/** Upgrade or repair a supported owned schema before strict offline maintenance. */
export async function migrateOmnipolymathAgentDatabaseForMaintenance(
  options: { agentId: string; pathname: string; env?: NodeJS.ProcessEnv; register?: boolean },
  maintenance: OmnipolymathStateLeaseContext,
): Promise<void> {
  const agentId = normalizeAgentId(options.agentId);
  const pathname = options.pathname;
  const env = { ...(options.env ?? process.env) };
  const cleanup = getAgentDeletionDatabaseCleanup({ agentId, path: pathname, env });
  const assertOwned = () => {
    maintenance.signal.throwIfAborted();
    assertAgentDatabaseMaintenanceAuthority(maintenance);
    cleanup?.assertCurrent();
  };
  assertOwned();
  invalidateOmnipolymathAgentDatabaseIntegrityBeforeMutation(pathname);
  const database = openNodeSqliteDatabase(pathname);
  try {
    invalidateSqliteSchemaFacts(database);
    configureSqliteMaintenanceCache(database);
    enableNodeSqliteKyselyStatementCache(database);
    database.exec(`PRAGMA busy_timeout = ${OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS};`);
    const metadata = readExistingAgentSchemaMeta(database);
    if (!metadata) {
      if (options.register) {
        assertOmnipolymathAgentDatabaseForMaintenance(database, { agentId, pathname });
      }
      return;
    }
    assertExistingAgentSchemaOwner(metadata, agentId, pathname);
    const userVersion = assertSupportedAgentSchemaVersion(database, pathname);
    const metadataVersion = metadata.schemaVersion;
    const hasCurrentVersion =
      userVersion === OMNIPOLYMATH_AGENT_SCHEMA_VERSION &&
      metadataVersion === OMNIPOLYMATH_AGENT_SCHEMA_VERSION;
    const hasSupportedOlderVersion =
      userVersion >= 1 &&
      userVersion < OMNIPOLYMATH_AGENT_SCHEMA_VERSION &&
      metadataVersion === userVersion;
    if (!hasCurrentVersion && !hasSupportedOlderVersion) {
      if (options.register) {
        assertOmnipolymathAgentDatabaseForMaintenance(database, { agentId, pathname });
      }
      return;
    }
    const repairIndexes = async () => {
      const changes = await repairDoctorSqliteIndexCorruptionAsync(database, pathname, {
        ftsSchemas: AGENT_FTS_SCHEMAS,
        label: `agent ${agentId}`,
        assertCurrent: () => {
          assertOwned();
          assertOmnipolymathAgentDatabaseOwner(database, { agentId, pathname });
          assertSupportedAgentSchemaVersion(database, pathname);
        },
      });
      for (const change of changes) {
        agentDbLog.warn(change);
      }
      return changes.length > 0;
    };
    if (userVersion === AGENT_MEDIA_SCHEMA_VERSION) {
      // v17 checks integrity inside its additive-schema transaction; repair only
      // physical indexes here so rejected migrations still roll schema changes back.
      await repairIndexes();
    }
    const operation = ensureOmnipolymathAgentDatabaseSchemaSteps(database, {
      agentId,
      path: pathname,
      env,
      register: options.register,
    });
    await runSqliteIntegrityOperationInWorker(operation, {
      busyTimeoutMs: OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS,
      signal: maintenance.signal,
      beforeResume: () => {
        assertOwned();
        invalidateSqliteSchemaFacts(database);
        assertExistingAgentSchemaOwner(readExistingAgentSchemaMeta(database), agentId, pathname);
        assertSupportedAgentSchemaVersion(database, pathname);
      },
      repairIntegrityError: repairIndexes,
    });
    assertOwned();
    assertOmnipolymathAgentDatabaseForMaintenance(database, {
      agentId,
      pathname,
    });
  } finally {
    clearNodeSqliteKyselyCacheForDatabase(database);
    database.close();
  }
}

/** Doctor prepares pending stores through their deletion owner without completing cleanup. */
export async function preparePendingAgentDeletionDatabasesForMaintenance(
  options: { targets: readonly { agentId: string; path: string }[]; env: NodeJS.ProcessEnv },
  maintenance: OmnipolymathStateLeaseContext,
): Promise<string[]> {
  const [{ withAgentDeletion }, { listPendingAgentDeletionJournalsAsync }] = await Promise.all([
    import("../agents/agent-lifecycle-registry.js"),
    import("./agent-deletion-journal.js"),
  ]);
  const { env } = options;
  const pending = await listPendingAgentDeletionJournalsAsync({ env });
  const pendingByAgent = new Map<string, string[]>();
  for (const target of options.targets) {
    const paths = pendingByAgent.get(target.agentId) ?? [];
    paths.push(target.path);
    pendingByAgent.set(target.agentId, paths);
  }
  const changes: string[] = [];
  for (const [agentId, paths] of pendingByAgent) {
    maintenance.assertOwned();
    const journal = pending.entries.find((entry) => entry.agentId === agentId);
    if (!journal) {
      throw new Error(`Agent ${agentId} deletion changed before schema preparation.`);
    }
    await withAgentDeletion(
      agentId,
      async (begin) => {
        const deletion = await begin(journal, { recoveryOperationId: journal.operationId });
        for (const pathname of paths) {
          await deletion.runDatabaseCleanup({ agentId, path: pathname }, () =>
            migrateOmnipolymathAgentDatabaseForMaintenance(
              { agentId, pathname, env, register: true },
              maintenance,
            ),
          );
          changes.push(
            `Prepared agent database schema in ${pathname} for pending deletion recovery.`,
          );
        }
      },
      { env },
    );
  }
  return changes;
}
