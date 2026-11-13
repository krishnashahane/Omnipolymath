import { executeExistingOmnipolymathStateRead } from "./omnipolymath-state-db-readonly.js";
import type { OmnipolymathStateDatabaseOptions } from "./omnipolymath-state-db.js";
import type { OmnipolymathIdUserProfiles } from "./user-profile-omnipolymath-id.types.js";

export { ensureCanonicalUserProfileForOmnipolymathIdIdentity } from "./user-profile-writes.js";

/** Reads display metadata and canonical references only; callers retain all access decisions. */
export async function readOmnipolymathIdUserProfiles(
  accountIds: readonly string[],
  options: Pick<OmnipolymathStateDatabaseOptions, "path" | "env"> = {},
): Promise<OmnipolymathIdUserProfiles> {
  if (!accountIds.length) {
    return {};
  }
  const reply = await executeExistingOmnipolymathStateRead(
    options,
    { type: "userProfiles.omnipolymathId.read", input: { accountIds: [...accountIds] } },
    { current: true },
  );
  return reply?.profiles ?? {};
}
