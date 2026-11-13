import { expect, it } from "vitest";
import type { AuthProfileCredential, UserModelAuthProfile } from "../agents/auth-profiles/types.js";
import { sqliteWorkerOwnerProbe as probe } from "../infra/sqlite-worker-owner-probe.test-support.js";
import { withOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";
import { resolveOmnipolymathStateSqlitePath } from "./omnipolymath-state-db.paths.js";
import {
  clearUserProfileAuthLink,
  connectUserModelAccount,
  setUserProfileAuthLink,
  updateUserModelAuthProfile,
} from "./user-model-accounts.js";
import { ensureProfileForEmail } from "./user-profiles.js";

const credential: AuthProfileCredential = {
  type: "token",
  provider: "synthetic",
  token: "synthetic-contention-token",
};

type Admit = (stage: "transaction" | "commit") => void;
type StructuredAdmit = (
  operation: { stage: "transaction" } | { stage: "commit"; profile: UserModelAuthProfile },
) => void;

const stageOf = (admission: string | { stage: "transaction" | "commit" }) =>
  typeof admission === "string" ? admission : admission.stage;

it.each([
  [
    "credential update",
    (admit: StructuredAdmit, _owner: string, profileId: string) =>
      updateUserModelAuthProfile(
        profileId,
        (profile) => {
          profile.usageStats = { lastUsed: 123 };
          return true;
        },
        {},
        admit,
      ),
  ],
  [
    "account connect",
    (admit: Admit, owner: string, _profileId: string) =>
      connectUserModelAccount({ ownerProfileId: owner, credential, assertCurrent: admit }),
  ],
  [
    "link selection",
    (admit: Admit, owner: string, profileId: string) =>
      setUserProfileAuthLink({
        profileId: owner,
        provider: credential.provider,
        authProfileId: profileId,
        assertCurrent: admit,
      }),
  ],
  [
    "unlink selection",
    (admit: Admit, owner: string, _profileId: string) =>
      clearUserProfileAuthLink({
        profileId: owner,
        provider: credential.provider,
        assertCurrent: admit,
      }),
  ],
] as const)("leaves the writer free while the host decides %s admission", async (_name, write) => {
  await withOmnipolymathTestState({ scenario: "minimal" }, async () => {
    const profile = ensureProfileForEmail("contention@example.test");
    const connected = connectUserModelAccount({
      ownerProfileId: profile.id,
      credential,
      assertCurrent() {},
    });
    using contention = probe.writerLock(resolveOmnipolymathStateSqlitePath());
    write(
      (admission) => contention.observe(stageOf(admission)),
      profile.id,
      connected.authProfileId,
    );
    expect(contention.observed).toEqual(["transaction:free", "commit:held"]);
  });
});
