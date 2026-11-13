import { withExistingOmnipolymathStateDatabaseReadOnly } from "./omnipolymath-state-db-readonly.js";
import { tableExists } from "./omnipolymath-state-db-schema-helpers.js";
import type { OmnipolymathStateDatabaseOptions } from "./omnipolymath-state-db.js";
import {
  projectUserProfileDisplays,
  selectHasMultipleSessionSharingIdentities,
  selectUserProfileIdentityInDatabase,
  selectUserProfileDisplaysInDatabase,
} from "./user-profile-identity.read.js";
import type { UserProfileDisplay } from "./user-profiles.types.js";

/** Native readers serve workers and the deprecated synchronous SDK factories only. */
export function getUserProfileDisplaysNative(
  profileIds: readonly string[],
  options: OmnipolymathStateDatabaseOptions = {},
): Map<string, UserProfileDisplay | undefined> {
  const ids = [...new Set(profileIds)];
  if (!ids.length) {
    return new Map();
  }
  return (
    withExistingOmnipolymathStateDatabaseReadOnly(({ db }) => {
      if (!tableExists(db, "user_profiles")) {
        return new Map();
      }
      const rows = selectUserProfileDisplaysInDatabase(db, ids);
      return projectUserProfileDisplays(ids, (id) => rows.get(id));
    }, options) ?? new Map()
  );
}

/** The sharing worker resolves aliases on a participant miss. */
export function readUserProfileAliasesNative(
  profileId: string,
  options: OmnipolymathStateDatabaseOptions = {},
): ReadonlySet<string> {
  const identity = withExistingOmnipolymathStateDatabaseReadOnly(
    ({ db }) =>
      tableExists(db, "user_profiles")
        ? selectUserProfileIdentityInDatabase(db, profileId)
        : undefined,
    options,
  );
  return new Set([profileId, ...(identity?.aliases ?? [])]);
}

/** @deprecated Synchronous SDK tool construction only; runtime prepares the profile catalog. */
export function hasMultipleSessionSharingIdentitiesNative(
  options: OmnipolymathStateDatabaseOptions = {},
): boolean {
  return (
    withExistingOmnipolymathStateDatabaseReadOnly(
      ({ db }) => tableExists(db, "user_profiles") && selectHasMultipleSessionSharingIdentities(db),
      options,
    ) ?? false
  );
}
