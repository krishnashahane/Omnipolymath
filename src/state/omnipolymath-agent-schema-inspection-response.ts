import { toStringifiedError } from "@omnipolymath/normalization-core/error-coercion";
import type { NativeErrorResponse } from "../infra/native-error-response-schema.js";
import {
  restoreNativeErrorResponse,
  serializeNativeErrorResponse,
} from "../infra/native-error-response.js";
import { formatSqliteReadOnlyInspectionFailure } from "../infra/sqlite-error-diagnostics.js";
import type { AgentSchemaInspection } from "./omnipolymath-agent-schema-inspection.js";
import type { StateSchemaInspection } from "./omnipolymath-state-schema-preflight.js";
import {
  encodeOmnipolymathStateWorkerError,
  hydrateOmnipolymathStateWorkerError,
  retainOmnipolymathStateWorkerErrorPayload,
  type OmnipolymathStateWorkerErrorPayload,
} from "./omnipolymath-state-worker-error.js";

type InspectionError = NativeErrorResponse & { stateError?: OmnipolymathStateWorkerErrorPayload };

/** Private IPC between the bundled inspection child and its scheduler. */
export type AgentSchemaInspectionResponse =
  | { requestId: number; ok: false; error: InspectionError }
  | {
      requestId: number;
      ok: true;
      inspection: (Omit<AgentSchemaInspection, "failure"> & { failure?: InspectionError }) | null;
      stateInspection?:
        | (Omit<StateSchemaInspection, "inspectionErrors"> & {
            inspectionErrors: InspectionError[];
          })
        | null;
    };

export function serializeAgentSchemaInspectionError(value: unknown): InspectionError {
  const error = toStringifiedError(value);
  return {
    ...serializeNativeErrorResponse(error),
    message: formatSqliteReadOnlyInspectionFailure(error),
    stateError: encodeOmnipolymathStateWorkerError(error),
  };
}

export function restoreAgentSchemaInspectionError(value: InspectionError): Error {
  const error = restoreNativeErrorResponse(value);
  if (value.stateError) {
    retainOmnipolymathStateWorkerErrorPayload(error, value.stateError);
  }
  const restored = hydrateOmnipolymathStateWorkerError(error);
  restored.message = value.message;
  return restored;
}
