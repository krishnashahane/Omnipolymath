import { extractErrorCode } from "@omnipolymath/normalization-core/error-coercion";
import { isPromiseLike } from "@omnipolymath/normalization-core/promise-like";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";

export class SqliteSnapshotCleanupError extends Error {}

/** A removal failure after retirement, never an admission or native-close failure. */
export class SqliteSnapshotDirectoryBusyError extends SqliteSnapshotCleanupError {
  override name = "SqliteSnapshotDirectoryBusyError";
}

/** Call only around final removal after retirement and native close have succeeded. */
export function classifyRetiredSqliteSnapshotRemovalError(
  directory: string,
  error: unknown,
): unknown {
  const code = extractErrorCode(error);
  if (
    error instanceof Error &&
    "syscall" in error &&
    (error.syscall === "rmdir" || error.syscall === "unlink") &&
    (code === "EBUSY" || code === "ENOTEMPTY")
  ) {
    return new SqliteSnapshotDirectoryBusyError(
      `SQLite retired snapshot directory removal is busy: ${directory}`,
      { cause: error },
    );
  }
  return error;
}

export class OmnipolymathStateOwnershipError extends Error {}

export class OmnipolymathStateOwnershipMetadataError extends OmnipolymathStateOwnershipError {
  constructor(
    readonly databasePath: string,
    message: string,
  ) {
    super(
      `Omnipolymath shared state ownership metadata is invalid at ${databasePath}: ${message}. ` +
        "Repair it with OMNIPOLYMATH_SUPERVISOR_MODE=external omnipolymath database ownership claim --manager <manager-id>.",
    );
    this.name = "OmnipolymathStateOwnershipMetadataError";
  }
}

export class OmnipolymathStateExternalOwnershipError extends OmnipolymathStateOwnershipError {
  constructor(
    readonly databasePath: string,
    readonly managerId: string,
  ) {
    super(
      `Omnipolymath shared state database ${databasePath} is externally supervised by ${managerId}. ` +
        "Use that external supervisor with OMNIPOLYMATH_SUPERVISOR_MODE=external for writable operations.",
    );
    this.name = "OmnipolymathStateExternalOwnershipError";
  }
}

// Worker error envelopes retain this name and identity across module reloads.
export const SqliteCoordinatorError = resolveGlobalSingleton(
  Symbol.for("omnipolymath.sqliteCoordinatorError"),
  () =>
    class CoordinatorError extends Error {
      constructor(
        message: string,
        public override readonly cause?: unknown,
      ) {
        super(message);
        this.name = "SqliteCoordinatorError";
      }
    },
);
export type SqliteCoordinatorError = InstanceType<typeof SqliteCoordinatorError>;

export function createSqliteLifecycleAggregateError(
  errors: unknown[],
  message: string,
  cause: unknown,
): AggregateError {
  return new AggregateError(errors, message, { cause });
}

/** Keep the first failure as the cause while retaining independent cleanup errors. */
export function throwSqliteLifecycleErrors(errors: unknown[], message: string): void {
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw createSqliteLifecycleAggregateError(errors, message, errors[0]);
  }
}

/** Settle a synchronous SQLite operation and preserve both operation and cleanup failures. */
export function runWithSqliteCleanup<T>(
  resource: { release: () => void },
  operationLabel: string,
  operation: () => T,
): T {
  let result: T;
  try {
    result = operation();
    if (isPromiseLike(result)) {
      throw new SqliteCoordinatorError(`${operationLabel} must remain synchronous`);
    }
  } catch (operationError) {
    try {
      resource.release();
    } catch (releaseError) {
      throw createSqliteLifecycleAggregateError(
        [operationError, releaseError],
        `${operationLabel} and resource release both failed`,
        operationError,
      );
    }
    throw operationError;
  }
  try {
    resource.release();
  } catch (releaseError) {
    throw new SqliteCoordinatorError(
      `${operationLabel} completed, but releasing its resource failed`,
      releaseError,
    );
  }
  return result;
}
