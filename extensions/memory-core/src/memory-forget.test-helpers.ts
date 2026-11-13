import path from "node:path";
import {
  resolveSessionTranscriptsDirForAgent,
  type OmnipolymathConfig,
} from "omnipolymath/plugin-sdk/memory-core-host-engine-foundation";
import { resetPluginStateStoreForTests } from "omnipolymath/plugin-sdk/plugin-state-test-runtime";
import { setRuntimeConfigSnapshot } from "omnipolymath/plugin-sdk/runtime-config-snapshot";
import { patchSessionEntry } from "omnipolymath/plugin-sdk/session-store-runtime";
import { openOmnipolymathAgentDatabase } from "omnipolymath/plugin-sdk/sqlite-runtime";
import { createOmnipolymathTestState } from "omnipolymath/plugin-sdk/test-state";
import { configureMemoryCoreDreamingStateForTests } from "./test-helpers.js";

export async function createMemoryForgetFixture(prefix = "omnipolymath-memory-forget-") {
  const state = await createOmnipolymathTestState({ prefix, layout: "state-only" });
  const { stateDir, workspaceDir } = state;
  await configureMemoryCoreDreamingStateForTests();
  const cfg: OmnipolymathConfig = {
    agents: { defaults: { workspace: workspaceDir }, entries: { main: {} } },
  };
  setRuntimeConfigSnapshot(cfg);
  return {
    stateDir,
    workspaceDir,
    cfg,
    cleanup: async () => {
      await state.restoreEnv();
      resetPluginStateStoreForTests();
      await state.cleanup();
    },
  };
}

export async function seedMemoryForgetSession(
  sessionId: string,
  hookSource?: "gmail" | "webhook",
): Promise<void> {
  const sessionKey = `agent:main:${sessionId}`;
  const entry = { sessionId, updatedAt: 1_000 };
  await patchSessionEntry({
    agentId: "main",
    storePath: path.join(resolveSessionTranscriptsDirForAgent("main"), "sessions.json"),
    sessionKey,
    update: () => entry,
    fallbackEntry: entry,
    replaceEntry: true,
    // Retention workers must not race direct schema setup or reclaim fixture sessions.
    skipMaintenance: true,
  });
  if (hookSource) {
    openOmnipolymathAgentDatabase({ agentId: "main" })
      .db.prepare(
        "UPDATE session_windows SET hook_external_content_source = ? WHERE session_id = ?",
      )
      .run(hookSource, sessionId);
  }
}
