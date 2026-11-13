import { afterEach, beforeEach } from "vitest";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../config/runtime-snapshot.js";
import { persistSessionTranscriptTurn } from "../config/sessions/session-accessor.js";
import { replaceTranscriptEvents } from "../config/sessions/session-accessor.sqlite-transcript-write.test-support.js";
import { openOmnipolymathAgentDatabase } from "../state/omnipolymath-agent-db.js";
import { createOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";

export function transcriptMessage(
  id: string,
  parentId: string | null,
  message: Record<string, unknown>,
  fields = {},
) {
  return { type: "message", id, parentId, ...fields, message };
}

/** Each case owns its environment and drains its database workers before removal. */
export function useTranscriptFixture(prefix: string) {
  let state: Awaited<ReturnType<typeof createOmnipolymathTestState>>;
  beforeEach(async () => {
    state = await createOmnipolymathTestState({ prefix, layout: "state-only" });
    setRuntimeConfigSnapshot({});
  });
  afterEach(async () => {
    await state.cleanup();
    clearRuntimeConfigSnapshot();
  });
  const scopeFor = (sessionId: string) => ({
    agentId: "main",
    sessionId,
    sessionKey: `agent:main:${sessionId}`,
    storePath: state.statePath("sessions.json"),
  });
  return {
    path: (...parts: string[]) => state.statePath(...parts),
    scopeFor,
    database: () =>
      openOmnipolymathAgentDatabase({
        agentId: "main",
        path: state.statePath("omnipolymath-agent.sqlite"),
      }),
    async writeTranscript(this: void, sessionId: string, events: unknown[]) {
      const scope = scopeFor(sessionId);
      await replaceTranscriptEvents(scope, [
        { type: "session", version: 3, id: sessionId },
        ...events,
      ]);
      return scope;
    },
    appendMessages: (
      scope: Parameters<typeof persistSessionTranscriptTurn>[0],
      messages: Array<{ role: string; content: unknown; display?: boolean; provenance?: unknown }>,
    ) =>
      persistSessionTranscriptTurn(scope, {
        messages: messages.map((message) => ({ message })),
        touchSessionEntry: false,
      }),
  };
}
