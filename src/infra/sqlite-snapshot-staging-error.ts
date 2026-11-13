import {
  hydrateOmnipolymathStateWorkerError,
  retainOmnipolymathStateWorkerErrorPayload,
  type OmnipolymathStateWorkerErrorPayload,
} from "../state/omnipolymath-state-worker-error.js";
import { SqliteSnapshotDirectoryBusyError } from "./sqlite-lifecycle-errors.js";

export function decodeSqliteSnapshotStagingError(
  payload: OmnipolymathStateWorkerErrorPayload | undefined,
): Error {
  const remote = new Error("SQLite snapshot staging failed");
  // SAFETY: The bundled staging worker encodes this private native-resource failure.
  retainOmnipolymathStateWorkerErrorPayload(remote, payload as OmnipolymathStateWorkerErrorPayload);
  const error = hydrateOmnipolymathStateWorkerError(remote, { includeOrdinary: true });
  return error.name === "SqliteSnapshotDirectoryBusyError"
    ? new SqliteSnapshotDirectoryBusyError(error.message, { cause: error.cause })
    : error;
}
