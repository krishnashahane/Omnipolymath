import { setTimeout as sleep } from "node:timers/promises";
import { computeBackoff } from "../infra/backoff.js";
import { withEngineStoreAdmission } from "../infra/database-engine/admission-scope.js";
import { isStateDatabaseMaintenanceContention } from "../infra/gateway-state-owner-record.js";
import { captureStateDatabaseAccess } from "../infra/gateway-state-owner.js";
import { isPostgresSqlConnection, type EngineConnection } from "../infra/sql-connection.js";
import { prepareSqliteDatabaseScopedWriteRevisionForPath } from "../infra/sqlite-database-admission.js";
import { isSqliteLockError } from "../infra/sqlite-error-diagnostics.js";
import { extractSqliteTableSchema } from "../infra/sqlite-schema-sql.js";
import type { SqliteTransactionOptions } from "../infra/sqlite-transaction.js";
import type { DatabasePathIdentity } from "../infra/sqlite-worker-identity.js";
import { retainOmnipolymathStateDatabaseForIdle } from "./omnipolymath-state-db-cache.js";
import type { OmnipolymathStateDatabase } from "./omnipolymath-state-db-contract.js";
import { isStatePostgres } from "./omnipolymath-state-db-engine.js";
import { runExistingOmnipolymathStateWriteTransaction } from "./omnipolymath-state-db-existing-write.js";
import { withOmnipolymathStateDatabaseReadOnly } from "./omnipolymath-state-db-readonly.js";
import {
  openOmnipolymathStateDatabase,
  runOmnipolymathStateWriteTransaction,
  runWithOmnipolymathStateBusyTimeout,
  type OmnipolymathStateDatabaseOptions,
} from "./omnipolymath-state-db.js";
import { resolveDatabasePath } from "./omnipolymath-state-db.paths.js";
import {
  createOmnipolymathStateLeaseLostError,
  toOmnipolymathStateLeaseVerificationError,
} from "./omnipolymath-state-lease-error.js";
import {
  LEASE_CONTENTION_RETRY_MS,
  LEASE_CONTENTION_RETRY_TIMEOUT_MS,
} from "./omnipolymath-state-lease-heartbeat-shared.js";
import {
  readOmnipolymathStateLeaseExpiry,
  readOmnipolymathStateLeaseLoss,
  releaseOmnipolymathStateLeaseInTransaction,
  renewOmnipolymathStateLeaseInTransaction,
  stateLeaseWriteScope,
} from "./omnipolymath-state-lease-store.js";
import type { OmnipolymathStateLeaseIdentity } from "./omnipolymath-state-lease.types.js";
import { getOmnipolymathDatabaseMaintenanceScope } from "./omnipolymath-state-maintenance-context.js";
import { OMNIPOLYMATH_STATE_SCHEMA_SQL } from "./omnipolymath-state-schema.js";
import type { OmnipolymathStateWorkerContext } from "./omnipolymath-state-worker-context.types.js";

export type OmnipolymathStateLeaseNativeSource = {
  context: OmnipolymathStateWorkerContext;
  identity: DatabasePathIdentity;
  database?: OmnipolymathStateDatabase;
};

export type OmnipolymathStateLeaseDatabase = {
  scope: "shared";
  options?: OmnipolymathStateDatabaseOptions;
  /** Storage compatibility only, never authority. Acquisition still claims the real lease. */
  schemaPolicy?: "existing";
};
const leaseSchema = ["schema_meta", "state_leases"]
  .map((table) =>
    extractSqliteTableSchema(OMNIPOLYMATH_STATE_SCHEMA_SQL, table, {
      endMarker: ") STRICT;",
      errorMessage: "Existing lease schema is unavailable.",
    }),
  )
  .join("\n");

export function prepareLeaseDatabase(database: OmnipolymathStateLeaseDatabase): void {
  if (database.schemaPolicy !== "existing") {
    runWithOmnipolymathStateBusyTimeout(() => undefined, database.options ?? {}, 0);
  }
}

export function resolveLeaseDatabasePath(database: OmnipolymathStateLeaseDatabase): string {
  return database.schemaPolicy === "existing"
    ? resolveDatabasePath(database.options)
    : openOmnipolymathStateDatabase(database.options).path;
}
function readLeaseDatabase<T>(
  database: OmnipolymathStateLeaseDatabase,
  operation: (db: EngineConnection) => T,
): T {
  return database.schemaPolicy === "existing"
    ? withOmnipolymathStateDatabaseReadOnly(({ db }) => operation(db), database.options)
    : operation(openOmnipolymathStateDatabase(database.options).db);
}

export function withLeaseWriteTransaction<T>(
  database: OmnipolymathStateLeaseDatabase,
  operationLabel: string,
  operation: (db: EngineConnection) => T,
  busyTimeoutMs = 0,
  singleStatement?: true,
): T {
  const transactionOptions = {
    operationLabel,
    busyTimeoutMs,
    beginLockFailureReporting: busyTimeoutMs === 0 ? "suppress" : undefined,
  } satisfies SqliteTransactionOptions;
  if (database.schemaPolicy === "existing") {
    return runExistingOmnipolymathStateWriteTransaction(
      ({ db }) => operation(db),
      database.options ?? {},
      { ...transactionOptions, schemaSql: leaseSchema },
    );
  }
  // Native renewal and release are lock primitives; their callers remain outside admission.
  return withEngineStoreAdmission(() => {
    const stateDatabase = database.options?.database ?? openOmnipolymathStateDatabase(database.options);
    return runOmnipolymathStateWriteTransaction(
      ({ db }) => operation(db),
      { ...database.options, database: stateDatabase },
      {
        ...transactionOptions,
        singleStatement:
          singleStatement && !isPostgresSqlConnection(stateDatabase.db) ? true : undefined,
      },
    );
  });
}

export const STATE_LEASE_WRITE_BACKOFF = {
  initialMs: LEASE_CONTENTION_RETRY_MS,
  maxMs: 250,
  factor: 1.5,
  jitter: 0.25,
} as const;

export type OmnipolymathStateLeaseOwnerIdentity = OmnipolymathStateLeaseIdentity &
  Parameters<typeof createOmnipolymathStateLeaseLostError>[0] & { leaseLabel: string };

export function createOmnipolymathStateLeaseLostErrorFromDatabase(
  identity: OmnipolymathStateLeaseOwnerIdentity,
  database: OmnipolymathStateLeaseDatabase,
  cause?: unknown,
) {
  let loss;
  try {
    loss = readLeaseDatabase(database, (db) => readOmnipolymathStateLeaseLoss(db, identity));
  } catch {
    // Expiry still fences the owner if storage or admission is unavailable.
  }
  return createOmnipolymathStateLeaseLostError(identity, cause, loss);
}

export function renewOmnipolymathStateLease(
  params: OmnipolymathStateLeaseOwnerIdentity & {
    database: OmnipolymathStateLeaseDatabase;
    operationLabel: string;
    leaseMs: number;
  },
): number {
  return withLeaseWriteTransaction(
    params.database,
    params.operationLabel === "state.lease" ? "state.lease.renew" : params.operationLabel,
    (db) => {
      const expiresAt = renewOmnipolymathStateLeaseInTransaction(db, params, params.leaseMs);
      if (expiresAt === undefined) {
        throw createOmnipolymathStateLeaseLostError(
          params,
          undefined,
          readOmnipolymathStateLeaseLoss(db, params),
        );
      }
      return expiresAt;
    },
  );
}

export function renewOmnipolymathStateLeaseForHandoff(
  params: Parameters<typeof renewOmnipolymathStateLease>[0],
): number {
  try {
    return renewOmnipolymathStateLease(params);
  } catch (error) {
    if (!isSqliteLockError(error)) {
      throw error;
    }
    return verifyOmnipolymathStateLeaseOwnership(params);
  }
}

function assertOmnipolymathStateLeaseOwnedInDatabase(
  database: EngineConnection,
  params: OmnipolymathStateLeaseOwnerIdentity,
): number {
  const expiresAt = readOmnipolymathStateLeaseExpiry(database, params);
  if (expiresAt === undefined) {
    throw createOmnipolymathStateLeaseLostError(
      params,
      undefined,
      readOmnipolymathStateLeaseLoss(database, params),
    );
  }
  return expiresAt;
}

export function verifyOmnipolymathStateLeaseOwnership(
  params: OmnipolymathStateLeaseOwnerIdentity & {
    database?: OmnipolymathStateLeaseDatabase;
    transaction?: EngineConnection;
  },
): number {
  try {
    if (params.transaction) {
      return assertOmnipolymathStateLeaseOwnedInDatabase(params.transaction, params);
    }
    const database = params.database;
    if (!database) {
      throw new Error("state lease ownership check requires a database");
    }
    const read = () =>
      readLeaseDatabase(database, (db) => assertOmnipolymathStateLeaseOwnedInDatabase(db, params));
    const maintenance = getOmnipolymathDatabaseMaintenanceScope();
    if (isStatePostgres() && maintenance?.ownsSchemaMaintenance) {
      // Doctor's synchronous lease check remains inside its admitted maintenance lifetime.
      maintenance.assertAdmission();
    }
    // Admit only the synchronous lease check; protected operations retain their own SQL boundary.
    return withEngineStoreAdmission(read);
  } catch (error) {
    throw toOmnipolymathStateLeaseVerificationError(params, error);
  }
}

/** Only a live Gateway's retained handle can reuse its complete in-process writer epochs. */
export async function prepareOmnipolymathStateLeaseVerification(
  native: OmnipolymathStateLeaseNativeSource | undefined,
  identity: OmnipolymathStateLeaseOwnerIdentity,
) {
  const opened = native?.database;
  // Existing-schema acquisition has no retained handle; maintenance keeps durable checks.
  if (!native || !opened || native.context.maintenanceScope || isPostgresSqlConnection(opened.db)) {
    return undefined;
  }
  const database = opened.db;
  const releaseIdle = retainOmnipolymathStateDatabaseForIdle(opened);
  let retained = false;
  try {
    const source = native.context;
    const access = await captureStateDatabaseAccess(source.admission.databasePath);
    const owner = access.processOwner;
    if (owner?.role !== "gateway") {
      return undefined;
    }
    const assertAccess = await access.prepareAccess();
    const revision = prepareSqliteDatabaseScopedWriteRevisionForPath(
      source.admission.databasePath,
      [stateLeaseWriteScope(identity)],
    );
    if (!revision) {
      return undefined;
    }
    let epoch: number | undefined;
    let expiresAt = 0;
    retained = true;
    return {
      verify() {
        source.admission.assertCurrent();
        owner.assertCurrent();
        assertAccess();
        const before = !database.isOpen || database.isTransaction ? undefined : revision.read();
        // Read the epoch before expiry: a settled renewal can extend this same grant.
        if (before !== undefined && before === epoch && Date.now() < expiresAt) {
          return;
        }
        epoch = undefined;
        const verifiedExpiry = verifyOmnipolymathStateLeaseOwnership({
          ...identity,
          transaction: database,
        });
        if (before !== undefined && before === revision.read()) {
          epoch = before;
          expiresAt = verifiedExpiry;
        }
      },
      release() {
        try {
          revision.release();
        } finally {
          releaseIdle();
        }
      },
    };
  } finally {
    if (!retained) {
      releaseIdle();
    }
  }
}

export function releaseOmnipolymathStateLease(
  params: OmnipolymathStateLeaseOwnerIdentity & {
    database: OmnipolymathStateLeaseDatabase;
    operationLabel: string;
  },
): void {
  withLeaseWriteTransaction(
    params.database,
    params.operationLabel === "state.lease" ? "state.lease.release" : params.operationLabel,
    (db) => releaseOmnipolymathStateLeaseInTransaction(db, params),
    0,
    true,
  );
}

export async function releaseOmnipolymathStateLeaseBestEffort(
  params: Parameters<typeof releaseOmnipolymathStateLease>[0],
  execute?: () => Promise<void>,
): Promise<void> {
  const deadline = performance.now() + LEASE_CONTENTION_RETRY_TIMEOUT_MS;
  let attempt = 0;
  while (true) {
    try {
      if (execute) {
        await execute();
      } else {
        releaseOmnipolymathStateLease(params);
      }
      return;
    } catch (error) {
      const now = performance.now();
      if (
        (!isSqliteLockError(error) && !isStateDatabaseMaintenanceContention(error)) ||
        now >= deadline
      ) {
        if (execute) {
          // The async resource owner retains failed cleanup for exact-owner retry.
          throw error;
        }
        return;
      }
      attempt += 1;
      // Cleanup outlives caller scheduling; native timers let competing writers settle.
      await sleep(Math.min(deadline - now, computeBackoff(STATE_LEASE_WRITE_BACKOFF, attempt)));
    }
  }
}
