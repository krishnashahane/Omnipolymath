import { requireNativeDatabaseFile } from "../infra/database-engine/physical-facts.js";
import {
  acquireStateDatabaseSchemaLease,
  assertStateDatabaseAccessAllowed,
} from "../infra/gateway-state-owner.js";
import { isGatewayExternallySupervised } from "../infra/gateway-supervision.js";
import {
  clearNodeSqliteKyselyCacheForDatabase,
  executeSqliteQuerySync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import type { EngineConnection } from "../infra/sql-connection.js";
import { isPostgresSqlConnection } from "../infra/sql-connection.js";
import { assertSqliteIntegrity } from "../infra/sqlite-integrity.js";
import {
  OmnipolymathStateOwnershipMetadataError,
  runWithSqliteCleanup,
} from "../infra/sqlite-lifecycle-errors.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import { configureSqliteWalMaintenance, type SqliteWalMaintenance } from "../infra/sqlite-wal.js";
import { omnipolymathStateDatabaseCache } from "./omnipolymath-state-db-cache.js";
import { OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS } from "./omnipolymath-state-db-contract.js";
import { assertOmnipolymathStateDatabaseForMaintenance } from "./omnipolymath-state-db-maintenance.js";
import type { DB as OmnipolymathStateKyselyDatabase } from "./omnipolymath-state-db.generated.js";
import {
  openOmnipolymathStateDatabase,
  runOmnipolymathStateWriteTransaction,
  type OmnipolymathStateDatabaseOptions,
} from "./omnipolymath-state-db.js";
import { resolveDatabasePath } from "./omnipolymath-state-db.paths.js";
import {
  inspectOmnipolymathStateOwnershipFromDatabase,
  normalizeOmnipolymathStateManagerId,
  publishOmnipolymathStateOwnership,
  STATE_SUPERVISION_KEY,
  type OmnipolymathExternalStateOwnership,
} from "./omnipolymath-state-ownership.js";

type OmnipolymathStateOwnershipOptions = Omit<OmnipolymathStateDatabaseOptions, "database" | "readOnly">;
type OwnershipDatabase = Pick<OmnipolymathStateKyselyDatabase, "config_machine_state">;

function requireOwnershipCheckpoint(
  walMaintenance: SqliteWalMaintenance,
  databasePath: string,
): void {
  if (!walMaintenance.checkpoint()) {
    throw new Error(
      `External ownership was committed for ${databasePath}, but its WAL checkpoint failed. Retry the same ownership claim before activating the supervisor.`,
    );
  }
}

function claimOwnershipRow(
  database: EngineConnection,
  databasePath: string,
  managerId: string,
  repairMalformed: boolean,
): OmnipolymathExternalStateOwnership {
  let current: OmnipolymathExternalStateOwnership | null = null;
  try {
    current = inspectOmnipolymathStateOwnershipFromDatabase(database, databasePath);
  } catch (error) {
    if (!repairMalformed || !(error instanceof OmnipolymathStateOwnershipMetadataError)) {
      throw error;
    }
  }
  if (current) {
    if (current.managerId !== managerId) {
      throw new Error(
        `Omnipolymath shared state is already claimed by external manager ${current.managerId}; ` +
          `manager ${managerId} cannot replace that durable ownership.`,
      );
    }
    return current;
  }
  const ownership: OmnipolymathExternalStateOwnership = {
    version: 1,
    mode: "external",
    managerId,
    claimedAt: Date.now(),
  };
  const valueJson = JSON.stringify(ownership);
  const stateDb = getNodeSqliteKysely<OwnershipDatabase>(database);
  executeSqliteQuerySync(
    database,
    stateDb
      .insertInto("config_machine_state")
      .values({
        state_key: STATE_SUPERVISION_KEY,
        value_json: valueJson,
        updated_at_ms: ownership.claimedAt,
      })
      .onConflict((conflict) =>
        conflict.column("state_key").doUpdateSet({
          value_json: valueJson,
          updated_at_ms: ownership.claimedAt,
        }),
      ),
  );
  publishOmnipolymathStateOwnership(database, ownership);
  return ownership;
}

function repairMalformedOwnershipClaim(
  databasePath: string,
  managerId: string,
): OmnipolymathExternalStateOwnership {
  assertStateDatabaseAccessAllowed(databasePath);
  const existing = omnipolymathStateDatabaseCache.getOmnipolymathStateDatabaseIfOpenAtPath(databasePath);
  const database = existing?.db ?? openNodeSqliteDatabase(databasePath);
  if (isPostgresSqlConnection(database)) {
    requireNativeDatabaseFile("postgres", "repair");
  }
  let walMaintenance: SqliteWalMaintenance | undefined;
  try {
    database.exec(`PRAGMA busy_timeout = ${OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS};`);
    assertSqliteIntegrity(database, databasePath);
    assertOmnipolymathStateDatabaseForMaintenance(database, { pathname: databasePath });
    walMaintenance =
      existing?.walMaintenance ??
      configureSqliteWalMaintenance(database, {
        busyTimeoutMs: OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS,
        checkpointIntervalMs: 0,
        checkpointMode: "TRUNCATE",
        databaseLabel: "Omnipolymath shared state ownership",
        databasePath,
      });
    const ownership = runSqliteImmediateTransactionSync(
      database,
      () => {
        assertStateDatabaseAccessAllowed(databasePath);
        return claimOwnershipRow(database, databasePath, managerId, true);
      },
      {
        busyTimeoutMs: OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS,
        databaseLabel: databasePath,
        operationLabel: "state.ownership.repair",
      },
    );
    requireOwnershipCheckpoint(walMaintenance, databasePath);
    return ownership;
  } finally {
    if (!existing) {
      walMaintenance?.close({ checkpointMode: "PASSIVE" });
      clearNodeSqliteKyselyCacheForDatabase(database);
      database.close();
    }
  }
}

/** Claim durable shared-state write ownership for the active external supervisor. */
export function claimOmnipolymathStateOwnership(
  managerId: string,
  options: OmnipolymathStateOwnershipOptions = {},
): OmnipolymathExternalStateOwnership {
  const env = options.env ?? process.env;
  if (!isGatewayExternallySupervised(env)) {
    throw new Error(
      "Claiming external shared-state ownership requires OMNIPOLYMATH_SUPERVISOR_MODE=external.",
    );
  }
  const normalizedManagerId = normalizeOmnipolymathStateManagerId(managerId);
  // Changing cached write authority needs exclusive custody through commit and checkpoint.
  const lease = acquireStateDatabaseSchemaLease(resolveDatabasePath(options), {
    busyTimeoutMs: 0,
  });
  return runWithSqliteCleanup(lease, "shared-state ownership claim", () =>
    lease.run(() => {
      try {
        const database = openOmnipolymathStateDatabase(options);
        const ownership = runOmnipolymathStateWriteTransaction(
          ({ db, path: databasePath }) =>
            claimOwnershipRow(db, databasePath, normalizedManagerId, false),
          { ...options, database },
          { operationLabel: "state.ownership.claim" },
        );
        requireOwnershipCheckpoint(database.walMaintenance, database.path);
        return ownership;
      } catch (error) {
        if (!(error instanceof OmnipolymathStateOwnershipMetadataError)) {
          throw error;
        }
        const ownership = repairMalformedOwnershipClaim(
          resolveDatabasePath(options),
          normalizedManagerId,
        );
        openOmnipolymathStateDatabase(options);
        return ownership;
      }
    }),
  );
}
