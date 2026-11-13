import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { expect, onTestFinished, vi } from "vitest";
import { writeSessionEntry } from "../config/sessions/session-accessor.sqlite-entry-store.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { reconstructAgentDeletionJournal } from "../state/agent-deletion-journal-recovery.js";
import { readAgentDeletionRecoveryHolds } from "../state/agent-deletion-journal-recovery.kernel.js";
import {
  closeOmnipolymathAgentDatabasesForTest,
  runOmnipolymathAgentWriteTransaction,
} from "../state/omnipolymath-agent-db.js";
import {
  openOmnipolymathStateDatabase,
  closeOmnipolymathStateDatabaseForTest,
  runOmnipolymathStateWriteTransaction,
} from "../state/omnipolymath-state-db.js";
import { captureEnv, setTestEnvValue } from "../test-utils/env.js";
import { nodeFilePath } from "../test-utils/node-file-path.js";
import {
  createOmnipolymathTestState,
  type OmnipolymathTestState,
} from "../test-utils/omnipolymath-test-state.js";

export async function createAgentTestState(
  label: string,
  options: Parameters<typeof createOmnipolymathTestState>[0] = {},
  beforeCleanup = () => {
    closeOmnipolymathAgentDatabasesForTest();
    closeOmnipolymathStateDatabaseForTest();
  },
) {
  const state = await createOmnipolymathTestState({ scenario: "minimal", label, ...options });
  onTestFinished(async () => {
    beforeCleanup();
    await state.cleanup();
  });
  const readConfig = () => fs.readFile(state.configPath, "utf8");
  return Object.assign(state, {
    readConfig,
    readJsonConfig: async (): Promise<OmnipolymathConfig> => JSON.parse(await readConfig()),
  });
}

export async function expectMissing(...paths: string[]) {
  for (const file of paths) {
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  }
}

export async function prepareRecoveryHolds(
  state: OmnipolymathTestState,
  agentId: string,
  held = [
    { agentId, path: path.join(state.agentDir(agentId), "omnipolymath-agent.sqlite") },
    { agentId, path: state.path("parked", "omnipolymath-agent.sqlite") },
    { agentId: "kept", path: path.join(state.agentDir("kept"), "omnipolymath-agent.sqlite") },
  ],
) {
  for (const target of held) {
    const key = `agent:${target.agentId}:main`;
    const entry = { sessionId: `preserved-${target.agentId}`, updatedAt: 1 };
    runOmnipolymathAgentWriteTransaction(
      (database) => writeSessionEntry(database, key, entry, { previousEntry: null }),
      { ...target, env: state.env },
    );
  }
  closeOmnipolymathAgentDatabasesForTest();
  runOmnipolymathStateWriteTransaction(
    (database) => {
      database.db.exec("DROP TABLE agent_deletion_journal");
      reconstructAgentDeletionJournal(database, held);
    },
    { env: state.env },
  );
  return {
    held,
    bytes: await Promise.all(held.map((target) => fs.readFile(target.path))),
    readBytes: () => Promise.all(held.map((target) => fs.readFile(target.path))),
    readHolds: () => readAgentDeletionRecoveryHolds(openOmnipolymathStateDatabase({ env: state.env })),
  };
}

type PreparationPhase = "workspace" | "workspace-write" | "config";
export function installWorkspacePreparationPause(
  workspace: string,
  phase: PreparationPhase,
  pause: (phase: PreparationPhase) => Promise<void>,
): () => void {
  const nativeModeEnv = captureEnv(["FS_SAFE_NATIVE_MODE"]);
  if (phase === "workspace-write") {
    setTestEnvValue("FS_SAFE_NATIVE_MODE", "off");
  }
  const realAccess = fs.access.bind(fs);
  const access = vi.spyOn(fs, "access").mockImplementation(async (file, mode) => {
    if (phase === "workspace" && file === path.join(workspace, "AGENTS.md")) {
      await pause("workspace");
    }
    return await realAccess(file, mode);
  });
  const realOpen = fs.open.bind(fs);
  const restoreWrites: Array<() => void> = [];
  let writePaused = false;
  const open = vi.spyOn(fs, "open").mockImplementation(async (file, flags, mode) => {
    const handle = await realOpen(file, flags, mode);
    const filePath = nodeFilePath(file);
    if (
      phase === "workspace-write" &&
      filePath &&
      path.dirname(filePath) === workspace &&
      typeof flags === "number" &&
      (flags & fsConstants.O_EXCL) !== 0
    ) {
      const realWrite = handle.write.bind(handle);
      const write = vi.spyOn(handle, "write").mockImplementation(async (...args) => {
        const result = await realWrite(...args);
        if (!writePaused) {
          writePaused = true;
          await pause("workspace-write");
        }
        return result;
      });
      restoreWrites.push(() => write.mockRestore());
    }
    return handle;
  });
  return () => {
    open.mockRestore();
    for (const restore of restoreWrites) {
      restore();
    }
    access.mockRestore();
    nativeModeEnv.restore();
  };
}
