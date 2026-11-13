import { resolveGlobalSingleton } from "../shared/global-singleton.js";

export type OmnipolymathDatabaseKind = "agent" | "state";
export type OmnipolymathDatabaseQuarantine = {
  kind: OmnipolymathDatabaseKind;
  quarantinedAt: number;
  reason: string;
};

export const DATABASE_QUARANTINE_READ_CLEANUP_ERROR_NAME = "OmnipolymathQuarantineReadCleanupError";

// Source and compiled worker modules must recognize the same cleanup error identity.
export const OmnipolymathQuarantineReadCleanupError = resolveGlobalSingleton(
  Symbol.for("omnipolymath.quarantineReadCleanupError"),
  () =>
    class QuarantineReadCleanupError extends AggregateError {
      constructor(
        errors: unknown[],
        readonly quarantine?: OmnipolymathDatabaseQuarantine,
      ) {
        super(errors, "Omnipolymath quarantine reader cleanup failed.", { cause: errors[0] });
        this.name = DATABASE_QUARANTINE_READ_CLEANUP_ERROR_NAME;
      }
    },
);
export type OmnipolymathQuarantineReadCleanupError = InstanceType<
  typeof OmnipolymathQuarantineReadCleanupError
>;
