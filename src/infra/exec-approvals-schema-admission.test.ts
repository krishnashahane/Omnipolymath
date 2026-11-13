import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { prepareExecutionIdentityContextAtAdmission } from "../audit/execution-identity.test-support.js";
import { insertOperatorApproval } from "../gateway/operator-approval-store.js";
import { listAgentProvenance } from "../state/agent-provenance.js";
import * as state from "../state/omnipolymath-state-db.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import { executeOmnipolymathStateWorker } from "../state/omnipolymath-state-worker-store.js";
import { listProfiles } from "../state/user-profile-reads.js";
import { commitExecAuthorizationLocked } from "./exec-approvals-authorization.js";
import { currentPolicyExec } from "./exec-approvals-current-policy.test-support.js";
import { writeExecApprovalsConfigRow } from "./exec-approvals-sqlite.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    await state.closeOmnipolymathStateDatabaseAsync();
    state.closeOmnipolymathStateDatabaseForTest();
    vi.unstubAllEnvs();
    cleanup();
  }),
);
const token = {
  tokenVersion: 1 as const,
  createdAt: Date.now(),
  runId: "integrity-run",
  contextId: "integrity-context",
  executionId: "integrity-execution",
};

type Surface = "roster" | "profiles" | "approval binding" | "message progress" | "message binding";
async function useFeature(surface: Surface, env: NodeJS.ProcessEnv, id: string) {
  if (surface === "roster") {
    expect(await listAgentProvenance({ env })).toEqual([]);
  } else if (surface === "profiles") {
    expect(await listProfiles({ env })).toEqual([]);
  } else if (surface === "approval binding") {
    const result = await insertOperatorApproval({
      databaseOptions: { env },
      approval: {
        id,
        kind: "exec",
        presentation: {
          kind: "exec",
          commandText: "printf synthetic",
          allowedDecisions: ["allow-once", "allow-always", "deny"],
        },
        source: { runId: token.runId },
        runtimeEpoch: "integrity-runtime",
        createdAtMs: 1_000,
        expiresAtMs: 10_000,
        executionIdentityToken: token,
      },
    });
    expect(result).toMatchObject({ outcome: "inserted" });
  } else {
    const binding = surface === "message binding";
    const result = await executeOmnipolymathStateWorker(captureOmnipolymathStateWorkerContext({ env }), {
      type: "audit.writer.process",
      input: [
        {
          type: "record-event",
          eventId: `admission-${surface}`,
          input: {
            sourceId: id,
            sourceSequence: 1,
            occurredAt: token.createdAt + 1,
            kind: "message",
            actorType: "agent",
            actorId: "main",
            runId: token.runId,
            direction: "outbound",
            channel: "qa-channel",
            conversationKind: "direct",
            ...(binding
              ? {
                  action: "message.outbound.finished",
                  status: "succeeded",
                  outcome: "sent",
                  resultCount: 1,
                  executionIdentityToken: token,
                }
              : {
                  action: "message.outbound.queued",
                  status: "started",
                  outcome: "queued",
                  resultCount: 0,
                }),
          },
        },
      ],
    });
    expect(result).toEqual([{ status: "settled" }]);
  }
}

it.each<Surface>(["roster", "profiles", "approval binding", "message progress", "message binding"])(
  "keeps prepared exec authority through the first %s operation after reopen",
  async (surface) => {
    const root = tempDirs.make("omnipolymath-exec-schema-admission-");
    const env = { OMNIPOLYMATH_STATE_DIR: root };
    vi.stubEnv("OMNIPOLYMATH_STATE_DIR", root);
    writeExecApprovalsConfigRow({
      db: state.openOmnipolymathStateDatabase({ env }).db,
      file: { version: 1, defaults: { security: "allowlist", ask: "on-miss" } },
    });
    if (surface === "message binding") {
      prepareExecutionIdentityContextAtAdmission(
        {
          runId: token.runId,
          agentId: "main",
          ingress: { kind: "local-cli", boundary: "agent-command.local", state: "present" },
          runtime: { kind: "embedded" },
        },
        {
          env,
          contextId: token.contextId,
          executionId: token.executionId,
          runtimeInstanceId: "integrity-runtime",
          now: token.createdAt,
        },
      );
    }
    await useFeature(surface, env, "prime");
    await state.closeOmnipolymathStateDatabaseAsync();
    const source = state.openOmnipolymathStateDatabase({ env });
    const before = source.db.prepare("PRAGMA schema_version").get();
    const assertCurrent = await commitExecAuthorizationLocked(
      currentPolicyExec("printf synthetic"),
    );
    expect(assertCurrent).not.toThrow();
    await useFeature(surface, env, "after-authorization");
    expect(source.db.prepare("PRAGMA schema_version").get()).toEqual(before);
    expect(assertCurrent).not.toThrow();
  },
);
