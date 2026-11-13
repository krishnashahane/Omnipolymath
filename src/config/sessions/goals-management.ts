import { randomUUID } from "node:crypto";
import { isRecord } from "@omnipolymath/normalization-core/record-coerce";
import { runtimeProcessEntrypoints } from "../../infra/runtime-process-entrypoints.js";
import { resolveRuntimeWorkerUrl } from "../../infra/runtime-worker-url.js";
import type { OmnipolymathAgentDatabaseOptions } from "../../state/omnipolymath-agent-db-contract.js";
import type { OmnipolymathAgentDatabaseExecution } from "../../state/omnipolymath-agent-execution-contract.js";
import { executeOmnipolymathAgentWorkerPublication } from "../../state/omnipolymath-agent-worker-store.js";
import type { SessionGoalManagementInput } from "./goals-operations.types.js";
import type {
  SessionGoalManagementCandidate,
  SessionGoalManagementOperations,
  SessionGoalManagementResult,
} from "./goals-operations.worker.js";
import { runSessionEntryWorkerOperation } from "./session-entry-patch.js";
import {
  acceptSessionSourceValidation,
  prepareSessionSourceAuthority,
  releaseSessionSourceAuthorities,
  type PreparedSessionSourceAuthority,
  type SessionSourceAssertion,
  type SessionSourceValidation,
} from "./session-source-authority.js";

export async function mutateSessionGoalInWorker(
  database: OmnipolymathAgentDatabaseOptions & { path: string },
  agentId: string,
  execution: OmnipolymathAgentDatabaseExecution,
  input: SessionGoalManagementInput,
  assertion: SessionSourceAssertion | undefined,
): Promise<SessionGoalManagementResult> {
  let source: PreparedSessionSourceAuthority;
  try {
    execution.assertCurrent();
    source = await prepareSessionSourceAuthority(assertion);
  } catch (error) {
    await releaseSessionSourceAuthorities([execution], [error]);
    throw error;
  }
  const release = () => releaseSessionSourceAuthorities([execution, source]);
  return runSessionEntryWorkerOperation<
    SessionGoalManagementCandidate,
    SessionGoalManagementResult
  >({
    database,
    retainedExecution: execution,
    agentId,
    candidateKind: "session-goal-management",
    onTransactionFacts(facts) {
      if (isRecord(facts) && facts.kind === "session-entry-patch-validated") {
        // SAFETY: The paired goal kernel supplies its transaction's matched source indices.
        acceptSessionSourceValidation(source, facts.sourceValidation as SessionSourceValidation);
        source.assertCurrent();
        return true;
      }
      return false;
    },
    assertCurrent: source.assertCurrent,
    releaseSource: release,
    assertCandidate(candidate) {
      if (candidate.refusedSource) {
        const refused = candidate.refusedSource;
        source.checks[refused.index]?.refuse(refused.facts);
        throw new Error("Goal source refusal omitted its authority assertion");
      }
    },
    run: (worker, commit) =>
      commit(() =>
        executeOmnipolymathAgentWorkerPublication<
          SessionGoalManagementOperations,
          "session.goal.mutate"
        >(worker, {
          id: randomUUID(),
          moduleUrl: resolveRuntimeWorkerUrl(runtimeProcessEntrypoints.sessionGoalOperations).href,
          input: { agentId: database.agentId },
          command: {
            type: "session.goal.mutate",
            input: { ...input, sources: source.checks.map(({ predicate }) => predicate) },
          },
        }),
      ),
    // Goal management cannot change session identity. The entry publication still settles in FIFO.
    onCommitted: (candidate) => {
      if (candidate.refusedSource) {
        throw new Error("Refused Goal source reached publication");
      }
      return candidate.result;
    },
  });
}
