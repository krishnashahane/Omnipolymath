import fs from "node:fs/promises";
import path from "node:path";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import type { OmnipolymathTestState } from "../../test-utils/omnipolymath-test-state.js";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import {
  loadRunOverflowCompactionHarness,
  createOverflowRunParams,
  resetSharedRunIntegrationHarnessMocks,
  warmRunOverflowCompactionHarness,
  type TestRunEmbeddedAgent,
} from "./run.overflow-compaction.harness.js";
import { guardRunWorkspaceOwnership } from "./run.workspace-ownership.test-support.js";

let sharedRunEmbeddedAgent: Promise<TestRunEmbeddedAgent> | undefined;
let sharedSessionState: Promise<OmnipolymathTestState> | undefined;
let sessionSequence = 0;

export async function createFreshRunIntegrationState(label: string) {
  resetSharedRunIntegrationHarnessMocks();
  const { createOmnipolymathTestState } = await import("../../test-utils/omnipolymath-test-state.js");
  const state = await createOmnipolymathTestState({ label });
  const { setRuntimeConfigSnapshot } = await import("../../config/runtime-snapshot.js");
  setRuntimeConfigSnapshot({});
  return state;
}

/** Warm the cross-owner module graph once, before per-case mocks and state. */
export function loadSharedRunIntegrationHarness(): Promise<TestRunEmbeddedAgent> {
  return (sharedRunEmbeddedAgent ??= (async () => {
    const { runEmbeddedAgent } = await loadRunOverflowCompactionHarness();
    const { withOmnipolymathTestState } = await import("../../test-utils/omnipolymath-test-state.js");
    await withOmnipolymathTestState({ label: "shared-run-warmup" }, async (state) => {
      const config: OmnipolymathConfig = {
        agents: { defaults: { workspace: state.workspaceDir } },
        session: { store: path.join(state.agentDir(), "omnipolymath-agent.sqlite") },
      };
      const { setRuntimeConfigSnapshot } = await import("../../config/runtime-snapshot.js");
      setRuntimeConfigSnapshot(config);
      const guard = await guardRunWorkspaceOwnership(state);
      try {
        await warmRunOverflowCompactionHarness(runEmbeddedAgent, state, { config });
      } finally {
        guard.verifyAndRestore();
      }
    });
    return runEmbeddedAgent;
  })());
}

/** Close only after every case has drained its work and released its selectors. */
export async function cleanupSharedRunIntegrationSessions(): Promise<void> {
  await (await sharedSessionState)?.cleanup();
}

/** Reuse real databases; each case owns distinct session rows and workspace files. */
export async function createSharedRunIntegrationSession() {
  const { createOmnipolymathTestState } = await import("../../test-utils/omnipolymath-test-state.js");
  const { captureEnv } = await import("../../test-utils/env.js");
  const { resetConfigRuntimeState, setRuntimeConfigSnapshot } =
    await import("../../config/runtime-snapshot.js");
  const { drainSessionStateForTest } = await import("../../test-utils/session-state-cleanup.js");
  const { loadSessionEntry, replaceSessionEntry } =
    await import("../../config/sessions/session-accessor.js");
  const { forgetActiveSessionForShutdown } =
    await import("../../gateway/active-sessions-shutdown-tracker.js");
  const state = await (sharedSessionState ??= createOmnipolymathTestState({
    label: "run-integration-sessions",
    applyEnv: false,
  }));
  const env = captureEnv(Object.keys(state.envVars));
  state.applyEnv();
  const caseId = ++sessionSequence;
  const sessionId = `test-session-${caseId}`;
  const sessionKey = `agent:main:test-key-${caseId}`;
  const workspaceDir = path.join(state.workspaceDir, `case-${caseId}`);
  const sessionTarget = {
    agentId: "main",
    sessionId,
    sessionKey,
    storePath: path.join(state.agentDir(), "omnipolymath-agent.sqlite"),
  };
  const config: OmnipolymathConfig = {
    agents: { defaults: { workspace: workspaceDir } },
    session: { store: sessionTarget.storePath },
  };
  setRuntimeConfigSnapshot(config);
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      await drainSessionStateForTest({ stateDir: state.stateDir, rootPath: state.root });
      forgetActiveSessionForShutdown(sessionId);
      const current = loadSessionEntry({ ...sessionTarget, readConsistency: "latest" });
      if (current) {
        forgetActiveSessionForShutdown(current.sessionId);
      }
      env.restore();
      resetConfigRuntimeState();
    })());
  try {
    await fs.mkdir(workspaceDir, { recursive: true });
    // The public lane owner still installs the real durable writer claim.
    await replaceSessionEntry(sessionTarget, { sessionId, updatedAt: 1 });
    return {
      runParams: {
        ...createOverflowRunParams({ workspaceDir }),
        config,
        sessionId,
        sessionKey,
        runId: `run-integration-${caseId}`,
        sessionTarget,
      },
      makeAttemptResult: (overrides?: Parameters<typeof makeAttemptResult>[0]) =>
        makeAttemptResult({ sessionIdUsed: sessionId, ...overrides }),
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
