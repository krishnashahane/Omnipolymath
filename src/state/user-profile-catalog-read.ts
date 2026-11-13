import { getOmnipolymathDatabaseMaintenanceScope } from "./omnipolymath-state-db-async-lifecycle.js";
import {
  executeExistingOmnipolymathStateRead,
  getActiveOmnipolymathStateDatabaseReadSnapshot,
} from "./omnipolymath-state-db-readonly.js";
import { getExistingOmnipolymathStateSchemaPath } from "./omnipolymath-state-db-schema-policy.js";
import type { OmnipolymathStateDatabaseOptions } from "./omnipolymath-state-db.js";

const pendingReads = new Map<
  string,
  ReturnType<typeof executeExistingOmnipolymathStateRead<{ type: "userProfiles.catalog" }>>
>();

/** Share only hydration; catalog consumers keep independent admission, authority, and leases. */
export function readUserProfileCatalogSnapshot(
  options: OmnipolymathStateDatabaseOptions,
  revision: { identityKey: string; profileRevision: number; bindingRevision: number },
) {
  const key =
    options.env ||
    options.database ||
    getOmnipolymathDatabaseMaintenanceScope() ||
    getExistingOmnipolymathStateSchemaPath() ||
    getActiveOmnipolymathStateDatabaseReadSnapshot(options)
      ? undefined
      : JSON.stringify([revision.identityKey, revision.profileRevision, revision.bindingRevision]);
  let pending = key && pendingReads.get(key);
  if (!pending) {
    pending = executeExistingOmnipolymathStateRead(
      options,
      { type: "userProfiles.catalog" },
      { current: true },
    ).finally(() => {
      if (key) {
        pendingReads.delete(key);
      }
    });
    if (key) {
      pendingReads.set(key, pending);
    }
  }
  return pending;
}
