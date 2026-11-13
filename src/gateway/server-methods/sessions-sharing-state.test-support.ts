import { upsertSessionEntryCore } from "../../config/sessions/session-accessor.js";
import { withOmnipolymathTestState } from "../../test-utils/omnipolymath-test-state.js";

export function seedSharingSession(
  sessionKey: string,
  sessionId: string,
  entry: Parameters<typeof upsertSessionEntryCore>[1] = {},
  agentId = "main",
) {
  return upsertSessionEntryCore({ agentId, sessionKey }, { updatedAt: 1, sessionId, ...entry });
}

export function createSharingState(initialize: () => unknown) {
  return (run: Parameters<typeof withOmnipolymathTestState>[1]) =>
    withOmnipolymathTestState({ scenario: "minimal", prepareProfileCatalog: true }, async (state) => {
      await initialize();
      await run(state);
    });
}
