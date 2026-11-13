import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { memorySessionActorOwners } from "../config/sessions/session-actor-memory-owner.js";
import {
  closeOmnipolymathAgentDatabasesAsync,
  closeOmnipolymathAgentDatabasesForTest,
  getOmnipolymathAgentDatabaseIfOpen,
} from "../state/omnipolymath-agent-db.js";
import { resolveIncognitoOmnipolymathAgentSqlitePath } from "../state/omnipolymath-agent-db.paths.js";
import {
  closeOmnipolymathStateDatabaseAsync,
  closeOmnipolymathStateDatabaseForTest,
} from "../state/omnipolymath-state-db.js";
import { recordMessageToolRunOutcome } from "./message-tool-run-outcome-store.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

let env: NodeJS.ProcessEnv;
let target: { agentId: string; env: NodeJS.ProcessEnv };
beforeEach(() => {
  env = { OMNIPOLYMATH_STATE_DIR: tempDirs.make("omnipolymath-message-tool-outcome-") };
  target = { agentId: "main", env };
});

type Outcome = Parameters<typeof recordMessageToolRunOutcome>[0];

const outcomeInput = (runId: string, overrides: Partial<Outcome> = {}) => ({
  ...target,
  sessionKey: "agent:main:main",
  provider: "openai",
  model: "gpt-5.6-luna",
  outcome: "mute" as const,
  runStatus: "completed" as const,
  occurredAt: 100,
  ...overrides,
  runId,
});

const recordOutcome = (runId: string, overrides?: Parameters<typeof outcomeInput>[1]) =>
  recordMessageToolRunOutcome(outcomeInput(runId, overrides));

afterEach(async () => {
  vi.restoreAllMocks();
  await closeOmnipolymathAgentDatabasesAsync();
  closeOmnipolymathAgentDatabasesForTest();
  await closeOmnipolymathStateDatabaseAsync();
  closeOmnipolymathStateDatabaseForTest();
});

describe("message-tool run outcome store", () => {
  it("does not recreate an absent incognito session for late outcome metadata", async () => {
    await expect(
      recordOutcome("private", {
        sessionKey: "agent:main:dashboard:incognito-outcome",
        runStatus: "aborted",
      }),
    ).rejects.toThrow("incognito");
    const privateTarget = { ...target, path: resolveIncognitoOmnipolymathAgentSqlitePath(target) };
    expect(memorySessionActorOwners.read(privateTarget)).toBeUndefined();
    expect(getOmnipolymathAgentDatabaseIfOpen(privateTarget)).toBeUndefined();
    expect(getOmnipolymathAgentDatabaseIfOpen(target)).toBeUndefined();
  });
});
