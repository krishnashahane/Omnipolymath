import {
  openOmnipolymathStateDatabase,
  type OmnipolymathStateDatabaseOptions,
} from "./omnipolymath-state-db.js";
import {
  inspectProfileAvatarInDatabase,
  readUserProfileAvatarCommand,
} from "./user-profiles-internal.js";

export function getProfileAvatar(profileId: string, options: OmnipolymathStateDatabaseOptions = {}) {
  const { db } = openOmnipolymathStateDatabase(options);
  const { profile, avatar } = inspectProfileAvatarInDatabase(db, profileId);
  return profile && avatar
    ? readUserProfileAvatarCommand(db, {
        type: "userProfiles.avatar.read",
        profileId,
        expected: { canonicalProfileId: profile.id, sha256: avatar.sha256, mime: avatar.mime },
      }).avatar
    : undefined;
}
