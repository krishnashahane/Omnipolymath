import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, vi } from "vitest";
import {
  resolveSessionTranscriptRuntimeTarget,
  upsertSessionEntryCore,
} from "../../config/sessions/session-accessor.js";
import { waitForSessionTranscriptIndexReconcilesInStateDir } from "../../config/sessions/session-transcript-reconcile.js";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import { closeOmnipolymathAgentDatabasesAsync } from "../../state/omnipolymath-agent-db.js";
import { closeOmnipolymathStateDatabaseByPathAsync } from "../../state/omnipolymath-state-db-cache.js";
import { openOmnipolymathStateDatabase } from "../../state/omnipolymath-state-db.js";
import { createWorkerTranscriptCommitStore } from "./transcript-commit-ledger.js";
import { createWorkerTranscriptCommitter } from "./transcript-commit.js";
import {
  createTranscriptCommitIdentity,
  createInterruptedCommitter,
  RUN_EPOCH,
  SESSION_ID,
} from "./transcript-commit.test-support.js";

export const SESSION_KEY = "agent:main:worker-transcript";
const ORIGINAL_REVISION = "worker-original-revision";
export const IDENTITY = createTranscriptCommitIdentity(SESSION_ID, RUN_EPOCH);

export function expectedCommitReceipt(entryIds: string[]) {
  return { ok: true, result: { entryIds, newLeafId: entryIds.at(-1) } };
}

export function requireSuccess(
  outcome: Awaited<ReturnType<ReturnType<typeof createWorkerTranscriptCommitter>["commit"]>>,
) {
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) {
    throw new Error(`expected transcript commit, received ${outcome.reason}`);
  }
  return outcome;
}

export async function createTranscriptCommitFixture(getConfig: () => OmnipolymathConfig) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "omnipolymath-worker-turn-"));
  vi.stubEnv("OMNIPOLYMATH_STATE_DIR", root);
  let stateDatabasePath: string | undefined;
  const close = async () => {
    try {
      await waitForSessionTranscriptIndexReconcilesInStateDir(root);
      await closeOmnipolymathAgentDatabasesAsync(root);
      if (stateDatabasePath) {
        await closeOmnipolymathStateDatabaseByPathAsync(stateDatabasePath);
      }
      await fs.rm(root, { recursive: true, force: true });
    } finally {
      vi.unstubAllEnvs();
    }
  };
  try {
    const storePath = path.join(root, "agents", "main", "sessions", "sessions.json");
    const cfg: OmnipolymathConfig = {
      agents: { entries: { main: {} } },
      session: {
        mainKey: "main",
        store: path.join(root, "agents", "{agentId}", "sessions", "sessions.json"),
      },
    };
    await upsertSessionEntryCore(
      { agentId: "main", sessionKey: SESSION_KEY, storePath },
      { lifecycleRevision: ORIGINAL_REVISION, sessionId: SESSION_ID, updatedAt: 10 },
    );
    const sessionTarget = await resolveSessionTranscriptRuntimeTarget({
      agentId: "main",
      sessionId: SESSION_ID,
      sessionKey: SESSION_KEY,
      storePath,
    });
    const owner = {
      identity: IDENTITY,
      sessionTarget: { ...sessionTarget, expectedLifecycleRevision: ORIGINAL_REVISION },
      assertCurrent: () => undefined,
    };
    const database = openOmnipolymathStateDatabase();
    stateDatabasePath = database.path;
    const ledgerStore = createWorkerTranscriptCommitStore({ database });
    const committer = createWorkerTranscriptCommitter({ getConfig, store: ledgerStore });
    const interrupt = (
      request: Parameters<typeof committer.commit>[0]["request"],
      message: string,
    ) => {
      const interrupted = createInterruptedCommitter(getConfig, ledgerStore, message);
      return expect(interrupted.commit({ ...owner, request })).rejects.toThrow(message);
    };
    return { root, storePath, cfg, sessionTarget, owner, ledgerStore, committer, interrupt, close };
  } catch (error) {
    await close();
    throw error;
  }
}
