import { MAX_TIMER_TIMEOUT_MS } from "@omnipolymath/normalization-core/number-coercion";
import type {
  OmnipolymathStateAsyncLeaseContext,
  OmnipolymathStateLeaseContext,
} from "./omnipolymath-state-lease-context.js";
import { OmnipolymathStateLeaseError } from "./omnipolymath-state-lease-error.js";
import type { OmnipolymathStateLeaseDatabase } from "./omnipolymath-state-lease-storage.js";
import type { OmnipolymathStateLeaseIdentity } from "./omnipolymath-state-lease.types.js";
import type { OmnipolymathStateWorkerContext } from "./omnipolymath-state-worker-context.types.js";

export type OmnipolymathStateLeaseOptions = {
  scope: string;
  key: string;
  database: OmnipolymathStateLeaseDatabase;
  leaseMs: number;
  waitMs: number;
  signal?: AbortSignal;
  /** Maintenance prepares normal storage before waiting for its operation lease. */
  prepareDatabase?: boolean;
  /** Maintenance can block the event loop for longer than the lease duration. */
  heartbeat?: "worker";
  /** Opt in only when no write-capable work can outlive the owning process. */
  processBound?: boolean;
  /** Stable diagnostic noun used in errors. */
  leaseLabel?: string;
  /** Stable transaction label used by SQLite diagnostics. */
  operationLabel?: string;
};

export type OmnipolymathStateLeaseInvocation<T> =
  | {
      kind: "native";
      options: OmnipolymathStateLeaseOptions;
      run: (lease: OmnipolymathStateLeaseContext, identity: OmnipolymathStateLeaseIdentity) => Promise<T>;
    }
  | {
      kind: "worker";
      options: OmnipolymathStateLeaseOptions;
      context: OmnipolymathStateWorkerContext;
      run: (
        lease: OmnipolymathStateAsyncLeaseContext,
        identity: OmnipolymathStateLeaseIdentity,
      ) => Promise<T>;
    };

const MIN_LEASE_MS = 1_000;
function invalidInput(message: string): OmnipolymathStateLeaseError {
  return new OmnipolymathStateLeaseError(message, { code: "OMNIPOLYMATH_STATE_LEASE_INVALID_INPUT" });
}

function validateDuration(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw invalidInput(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function validateNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw invalidInput(`${label} must be a non-empty string without NUL bytes`);
  }
  return value;
}

export function validateOmnipolymathStateLeaseOptions(options: OmnipolymathStateLeaseOptions) {
  const database = options.database;
  const leaseLabel =
    options.leaseLabel === undefined
      ? "state lease"
      : validateNonEmptyString(options.leaseLabel, "state lease label");
  const operationLabel =
    options.operationLabel === undefined
      ? "state.lease"
      : validateNonEmptyString(options.operationLabel, "state lease operationLabel");
  return {
    scope: validateNonEmptyString(options.scope, `${leaseLabel} scope`),
    key: validateNonEmptyString(options.key, `${leaseLabel} key`),
    database,
    leaseMs: validateDuration(
      options.leaseMs,
      `${leaseLabel} leaseMs`,
      MIN_LEASE_MS,
      MAX_TIMER_TIMEOUT_MS,
    ),
    waitMs: validateDuration(options.waitMs, `${leaseLabel} waitMs`, 0, MAX_TIMER_TIMEOUT_MS),
    signal: options.signal,
    prepareDatabase: options.prepareDatabase === true,
    heartbeat: options.heartbeat,
    processBound: options.processBound === true,
    leaseLabel,
    operationLabel,
  };
}
