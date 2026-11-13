import { describe, expect, it } from "vitest";
import {
  closeOmnipolymathStateDatabaseByPathAsync,
  openOmnipolymathStateDatabase,
} from "../../state/omnipolymath-state-db.js";
import {
  getCanonicalUserPreferences,
  setCanonicalUserPreferences,
} from "../../state/user-preferences.js";
import { ensureGatewayOwnerProfile } from "../../state/user-profiles.js";
import { withEngineStoreAdmission as admit } from "./admission-scope.js";
import { mixedAgentConnection, useMixedAgentPair } from "./mixed-agent.conformance.test-support.js";

describe.skipIf(!mixedAgentConnection).each(["sqlite", "postgres"] as const)(
  "%s domain commit receipts",
  (engine) => {
    useMixedAgentPair(engine, "sqlite");

    it("acknowledges ordinary preference writes and reads them back after reopening", async () => {
      const { profile, databasePath } = admit(() => ({
        profile: ensureGatewayOwnerProfile("Receipt conformance operator"),
        databasePath: openOmnipolymathStateDatabase().path,
      }));
      const entries = { "notifications.enabled": true };
      const outcome = await setCanonicalUserPreferences(profile.id, entries).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await closeOmnipolymathStateDatabaseByPathAsync(databasePath);
      const persisted = await getCanonicalUserPreferences(profile.id);
      expect({ outcome, persisted }).toEqual({
        outcome: { value: { ok: true, value: { profileId: profile.id } } },
        persisted: { profileId: profile.id, entries },
      });
    });
  },
);
