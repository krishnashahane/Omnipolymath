import path from "node:path";
import { expect } from "vitest";
import { resolveSessionStorePathCore } from "../config/sessions/paths.js";
import {
  loadExactSessionEntryReadOnly,
  loadTranscriptEvents,
} from "../config/sessions/session-accessor.js";
import { resolveSqliteTargetFromSessionStorePath } from "../config/sessions/session-sqlite-target.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { openOmnipolymathAgentDatabase } from "../state/omnipolymath-agent-db.js";
import {
  insertLegacySession,
  repairCanonicalSessionKeys,
} from "./doctor-session-canonical-keys.test-support.js";

export function createCanonicalRepairFixture(
  stateDir: string,
  mainKey?: string,
  agentIds = ["main"],
) {
  const env = { ...process.env, OMNIPOLYMATH_STATE_DIR: stateDir };
  const store = path.join(stateDir, "agents", "{agentId}", "sessions.json");
  const cfg: OmnipolymathConfig = {
    agents: { entries: Object.fromEntries(agentIds.map((id) => [id, {}])) },
    session: { store, ...(mainKey ? { mainKey } : {}) },
  };
  const scope = (agentId = "main") => ({
    agentId,
    env,
    storePath: resolveSessionStorePathCore(store, { agentId, env }),
  });
  const database = (agentId = "main") => {
    const target = scope(agentId);
    return openOmnipolymathAgentDatabase({
      agentId,
      env,
      path: resolveSqliteTargetFromSessionStorePath(target.storePath, target).path,
    });
  };
  const load = (sessionKey: string, agentId = "main") =>
    loadExactSessionEntryReadOnly({ ...scope(agentId), sessionKey });
  const insert = (
    sessionKey: string,
    entry: Parameters<typeof insertLegacySession>[0]["entry"],
    eventText?: string,
    agentId = "main",
  ) => insertLegacySession({ ...scope(agentId), sessionKey, entry, eventText });
  const transcript = async (sessionKey: string, sessionId: string, content?: string) => {
    await expect(loadTranscriptEvents({ ...scope(), sessionKey, sessionId })).resolves.toEqual(
      content === undefined
        ? []
        : [expect.objectContaining({ message: expect.objectContaining({ content }) })],
    );
  };
  const repair = (apply = true) => repairCanonicalSessionKeys({ apply, cfg, env });
  const expectRepair = async (
    expected: Partial<Awaited<ReturnType<typeof repair>>>,
    apply = true,
  ) => expect(await repair(apply)).toMatchObject(expected);
  return { cfg, env, scope, database, load, insert, transcript, repair, expectRepair };
}
