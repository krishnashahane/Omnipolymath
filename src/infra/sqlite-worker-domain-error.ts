import {
  encodeOmnipolymathStateWorkerError,
  type OmnipolymathStateWorkerErrorPayload,
} from "../state/omnipolymath-state-worker-error.js";
import type { EngineConnection } from "./sql-connection.js";
import { assertTransactionUsable } from "./sqlite-transaction.js";

/** Keep unsettled native failures with the broker; only settled errors become domain refusals. */
export function encodeSqliteWorkerDomainError(
  database: EngineConnection,
  error: unknown,
): OmnipolymathStateWorkerErrorPayload {
  assertTransactionUsable(database);
  if (!database.isOpen || database.isTransaction) {
    throw error;
  }
  const failure = encodeOmnipolymathStateWorkerError(error, { includeOrdinary: true });
  if (!failure) {
    throw error;
  }
  return failure;
}
