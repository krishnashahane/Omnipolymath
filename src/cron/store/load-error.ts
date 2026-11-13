import type { SqliteWorkerReply } from "../../infra/sqlite-worker-contract.js";
import {
  encodeOmnipolymathStateWorkerError,
  hydrateOmnipolymathStateWorkerError,
  retainOmnipolymathStateWorkerErrorPayload,
} from "../../state/omnipolymath-state-worker-error.js";

type CronLoadError = Extract<SqliteWorkerReply, { ok: false }>["error"];

export function serializeCronLoadError(value: unknown): CronLoadError {
  const error = value instanceof Error ? value : new Error(String(value));
  const code = "code" in error ? error.code : undefined;
  const sharedState = encodeOmnipolymathStateWorkerError(error, { includeOrdinary: true });
  return {
    name: error.name,
    message: error.message,
    ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
    ...(sharedState ? { sharedState } : {}),
  };
}

export function restoreCronLoadError(value: CronLoadError): Error {
  const error = Object.assign(new Error(value.message), {
    name: value.name,
    ...(value.code === undefined ? {} : { code: value.code }),
  });
  if (value.sharedState) {
    retainOmnipolymathStateWorkerErrorPayload(error, value.sharedState);
  }
  return hydrateOmnipolymathStateWorkerError(error, { includeOrdinary: true });
}
