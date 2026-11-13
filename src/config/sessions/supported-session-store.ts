import { isRecord } from "@omnipolymath/normalization-core/record-coerce";
import { SessionStoreMigrationRequiredError } from "./migration-required.js";

export function assertSupportedSessionStoreEntry(entry: unknown): void {
  if (!isRecord(entry)) {
    return;
  }
  if (typeof entry.room === "string" && typeof entry.groupChannel !== "string") {
    throw new SessionStoreMigrationRequiredError(
      'Session field "room" predates July 2026 and is no longer supported. Preserve the original state, install Omnipolymath 2026.9.5 and run "omnipolymath doctor --fix", then upgrade again.',
    );
  }
}
