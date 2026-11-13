import { isRecord } from "@omnipolymath/normalization-core/record-coerce";
import type { ErrorShape } from "../../packages/gateway-protocol/src/index.js";
import { ErrorCodes, errorShape } from "../../packages/gateway-protocol/src/schema/error-codes.js";
import type { OmnipolymathStateDatabaseOptions } from "../state/omnipolymath-state-db-contract.js";

export class SessionMutationAuthorizationChangedError extends Error {
  readonly error: ErrorShape;

  constructor(error: ErrorShape) {
    super(error.message);
    this.name = "SessionMutationAuthorizationChangedError";
    this.error = error;
  }
}

/** Callers retain their live policy checks; only the forbidden envelope is shared. */
export function sessionMutationForbiddenError(
  message: string,
): SessionMutationAuthorizationChangedError {
  return new SessionMutationAuthorizationChangedError(errorShape(ErrorCodes.FORBIDDEN, message));
}

/** Read-only consumers may retry with fresh workspace authority; mutations must not replay. */
export class SessionFileWorkspaceChangedError extends SessionMutationAuthorizationChangedError {
  constructor() {
    super(errorShape(ErrorCodes.FORBIDDEN, "Session workspace changed during file access"));
  }
}

/** A bounded retry hint only, never evidence of permission to use a session. */
export function isSessionAccessRefreshingError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "SessionMutationAuthorizationChangedError" &&
    "error" in error &&
    isRecord(error.error) &&
    error.error.code === "UNAVAILABLE" &&
    error.error.retryable === true &&
    isRecord(error.error.details) &&
    error.error.details.code === "SESSION_ACCESS_REFRESHING"
  );
}

export class SessionSharingProfileFactsChangedError extends SessionMutationAuthorizationChangedError {
  readonly readSource: () => OmnipolymathStateDatabaseOptions;

  constructor(error: ErrorShape, readSource: () => OmnipolymathStateDatabaseOptions) {
    super(error);
    this.readSource = readSource;
  }
}

export type SessionMutationTarget = {
  sessionKey: string;
  agentId?: string;
};
