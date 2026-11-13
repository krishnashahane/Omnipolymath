import { extractErrorCode, toErrorObject } from "@omnipolymath/normalization-core/error-coercion";
import { formatSqliteErrorCodeSuffix } from "../infra/sqlite-error-diagnostics.js";
import { formatStateLeaseLoss } from "../shared/state-lease-loss-format.js";
import type { StateLeaseLoss } from "../shared/state-lease-loss.js";

/** Renewal diagnostics omit error prose, stacks, and database paths. */
export function formatLeaseRenewalError(error: unknown): string {
  const name = toErrorObject(error, "State lease renewal failed").name;
  const code = extractErrorCode(error);
  const safeCode = code && /^[A-Za-z0-9_-]{1,64}$/u.test(code) ? code : "unknown";
  return `errorName=${/^[A-Za-z][A-Za-z0-9_.]{0,63}$/u.test(name) ? name : "unknown"}, errorCode=${safeCode}${formatSqliteErrorCodeSuffix(error)}`;
}

export type OmnipolymathStateLeaseErrorCode =
  | "OMNIPOLYMATH_STATE_LEASE_INVALID_INPUT"
  | "OMNIPOLYMATH_STATE_LEASE_HELD"
  | "OMNIPOLYMATH_STATE_LEASE_ABORTED"
  | "OMNIPOLYMATH_STATE_LEASE_LOST"
  | "OMNIPOLYMATH_STATE_LEASE_STORAGE_FAILED";

type OmnipolymathStateLeaseAcquisitionFailure =
  | { kind: "held"; holder: { owner: string; epoch: number } }
  | { kind: "store-unavailable"; reason: "sqlite-busy" | "lifecycle-busy" | "storage-error" }
  | { kind: "aborted"; reason: "caller-signal"; elapsedMs: number };

export class OmnipolymathStateLeaseError extends Error {
  readonly code: OmnipolymathStateLeaseErrorCode;
  readonly loss?: StateLeaseLoss;

  constructor(
    message: string,
    options: { code: OmnipolymathStateLeaseErrorCode; cause?: unknown; loss?: StateLeaseLoss },
  ) {
    super(message, { cause: options.cause });
    this.name = "OmnipolymathStateLeaseError";
    this.code = options.code;
    this.loss = options.loss;
  }
}

export class OmnipolymathStateLeaseAcquisitionError extends OmnipolymathStateLeaseError {
  constructor(
    label: string,
    readonly outcome: OmnipolymathStateLeaseAcquisitionFailure,
    cause?: unknown,
  ) {
    super(
      outcome.kind === "held"
        ? `${label} is held by ${outcome.holder.owner} (lease epoch ${outcome.holder.epoch})`
        : outcome.kind === "aborted"
          ? `${label} acquisition was aborted after ${outcome.elapsedMs} ms by caller signal`
          : `failed to acquire ${label}: store unavailable (${outcome.reason})`,
      {
        code:
          outcome.kind === "held"
            ? "OMNIPOLYMATH_STATE_LEASE_HELD"
            : outcome.kind === "aborted"
              ? "OMNIPOLYMATH_STATE_LEASE_ABORTED"
              : "OMNIPOLYMATH_STATE_LEASE_STORAGE_FAILED",
        cause,
      },
    );
  }
}

export function toOmnipolymathStateLeaseVerificationError(
  identity: { scope: string; key: string; leaseLabel?: string },
  error: unknown,
): OmnipolymathStateLeaseError {
  return error instanceof OmnipolymathStateLeaseError
    ? error
    : new OmnipolymathStateLeaseError(
        `failed to verify ${identity.leaseLabel ?? "state lease"} ${identity.scope}/${identity.key}`,
        { code: "OMNIPOLYMATH_STATE_LEASE_STORAGE_FAILED", cause: error },
      );
}

export function createOmnipolymathStateLeaseError(
  code: OmnipolymathStateLeaseErrorCode,
  message: string,
  cause?: unknown,
  loss?: StateLeaseLoss,
): OmnipolymathStateLeaseError {
  return new OmnipolymathStateLeaseError(message, { code, cause, loss });
}

export function createOmnipolymathStateLeaseLostError(
  identity: {
    scope: string;
    key: string;
    leaseLabel?: string;
    renewalTimer?: { dueAt?: number; lateByMs: number };
  },
  cause?: unknown,
  loss?: StateLeaseLoss,
): OmnipolymathStateLeaseError {
  const timer = identity.renewalTimer;
  const lateByMs = timer
    ? Math.max(timer.lateByMs, timer.dueAt === undefined ? 0 : Date.now() - timer.dueAt)
    : 0;
  const diagnostic =
    loss?.reason === "expired" && lateByMs > 0 ? { ...loss, renewalTimerLateByMs: lateByMs } : loss;
  return new OmnipolymathStateLeaseError(
    `${identity.leaseLabel ?? "state lease"} ${identity.scope}/${identity.key} was lost${diagnostic ? ` (${formatStateLeaseLoss(diagnostic)})` : ""}; retry the operation`,
    { code: "OMNIPOLYMATH_STATE_LEASE_LOST", cause, loss: diagnostic },
  );
}

export function createOmnipolymathStateLeaseAbortError(
  signal: AbortSignal,
  label: string,
  leaseLabel: string,
): OmnipolymathStateLeaseError {
  return createOmnipolymathStateLeaseError(
    "OMNIPOLYMATH_STATE_LEASE_ABORTED",
    `${leaseLabel} ${label} was aborted`,
    signal.reason,
  );
}

export function resolveOmnipolymathStateLeaseOperationError(
  operationError: unknown,
  settledError: unknown,
  authorityError: unknown,
): unknown {
  if (!(authorityError instanceof Error)) {
    return settledError;
  }
  if (settledError !== operationError && authorityError instanceof OmnipolymathStateLeaseError) {
    // Nested owners retain the caller's authority code and all operation/drainage causes.
    const { code, message, loss } = authorityError;
    return createOmnipolymathStateLeaseError(code, message, settledError, loss);
  }
  return authorityError;
}
