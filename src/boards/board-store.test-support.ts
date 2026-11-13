import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { onTestFinished } from "vitest";
import { replaceSessionEntrySync } from "../config/sessions/session-accessor.entry.js";
import { parseAgentSessionKey } from "../routing/session-key.js";
import {
  closeOmnipolymathAgentDatabasesAsync,
  closeOmnipolymathAgentDatabasesForTest,
  openOmnipolymathAgentDatabase,
} from "../state/omnipolymath-agent-db.js";
import {
  closeOmnipolymathStateDatabaseAsync,
  closeOmnipolymathStateDatabaseForTest,
} from "../state/omnipolymath-state-db.js";
import type { BoardStore, BoardSessionTarget } from "./board-store.js";
import { SqliteBoardStore } from "./sqlite-board-store.js";

export async function closeBoardDatabases() {
  await closeOmnipolymathAgentDatabasesAsync();
  closeOmnipolymathAgentDatabasesForTest();
  await closeOmnipolymathStateDatabaseAsync();
  closeOmnipolymathStateDatabaseForTest();
}

export function createTestBoardStore(options: { stateDir?: string } = {}): SqliteBoardStore {
  const ownsStateDir = options.stateDir === undefined;
  const stateDir = options.stateDir ?? mkdtempSync(path.join(tmpdir(), "omnipolymath-board-store-"));
  const env = { OMNIPOLYMATH_STATE_DIR: stateDir };
  const seededSessions = new Set<string>();

  if (ownsStateDir) {
    onTestFinished(async () => {
      await closeBoardDatabases();
      rmSync(stateDir, { recursive: true, force: true });
    });
  }

  return new SqliteBoardStore({
    resolveSession: ({ sessionKey, agentId: requestedAgentId }) => {
      const parsed = parseAgentSessionKey(sessionKey);
      const agentId = requestedAgentId ?? parsed?.agentId ?? "main";
      // Mirror the Gateway resolver so shorthand keys exercise canonical persisted rows.
      const canonicalSessionKey =
        parsed || sessionKey === "global" || sessionKey === "unknown"
          ? sessionKey
          : `agent:${agentId}:${sessionKey}`;
      const identity = `${agentId}\0${canonicalSessionKey}`;
      if (!seededSessions.has(identity)) {
        const database = openOmnipolymathAgentDatabase({ agentId, env });
        replaceSessionEntrySync(
          { agentId, sessionKey: canonicalSessionKey, storePath: database.path },
          { sessionId: `board-test-${seededSessions.size}`, updatedAt: Date.now() },
        );
        seededSessions.add(identity);
      }
      return { agentId, sessionKey: canonicalSessionKey };
    },
    env,
  });
}

export async function readBoardHtml(store: BoardStore, target: BoardSessionTarget, name: string) {
  return await store.useWidgetDocument(target, name, (document) =>
    document && "html" in document ? document : undefined,
  );
}
