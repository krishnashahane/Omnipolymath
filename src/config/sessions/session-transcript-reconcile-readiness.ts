import { createAbortError } from "../../infra/abort-signal.js";
import { withOmnipolymathAgentDatabaseReadOnly } from "../../state/omnipolymath-agent-db-readonly.js";
import { isAgentDatabaseClosing } from "../../state/omnipolymath-agent-db-resources.js";
import {
  resolveOmnipolymathAgentSqlitePath,
  type OmnipolymathAgentDatabaseOptions,
} from "../../state/omnipolymath-agent-db.js";
import {
  captureOmnipolymathAgentDatabaseExecution,
  supportsOmnipolymathAgentDatabaseExecution,
} from "../../state/omnipolymath-agent-execution.js";
import { sessionTranscriptIndexNeedsReconcile } from "./session-transcript-index.js";
import { withSessionHistoryWorkerDatabase } from "./session-transcript-worker-runtime.js";

export type SessionTranscriptReconcileParams = OmnipolymathAgentDatabaseOptions & {
  preferredSessionId?: string;
  assertCurrent?: () => void;
  signal?: AbortSignal;
};

export type PreparedReconcileParams = SessionTranscriptReconcileParams & {
  env: NodeJS.ProcessEnv;
};
export function prepareReconcileParams(
  params: SessionTranscriptReconcileParams,
): PreparedReconcileParams {
  const path = resolveOmnipolymathAgentSqlitePath(params);
  // Deferred work retains the state owner selected before scheduling or admission.
  return {
    ...params,
    path,
    env: { ...(params.env ?? process.env) },
  };
}

/** Observe readiness without rebuilding or sweeping projections. */
export async function readSessionTranscriptProjectionStatus(
  databaseOptions: PreparedReconcileParams,
  sessionId: string,
  abortSignal?: AbortSignal,
): Promise<boolean> {
  if (supportsOmnipolymathAgentDatabaseExecution(databaseOptions)) {
    const closing = isAgentDatabaseClosing({
      agentId: databaseOptions.agentId,
      path: resolveOmnipolymathAgentSqlitePath(databaseOptions),
    });
    if (closing) {
      if (abortSignal?.aborted) {
        throw createAbortError("Operation aborted", { cause: abortSignal.reason });
      }
      // Readiness is best effort during retirement; the close caller owns settlement.
      return false;
    }
    const execution = captureOmnipolymathAgentDatabaseExecution(databaseOptions);
    try {
      execution.assertCurrent();
      return await withSessionHistoryWorkerDatabase(databaseOptions, (owner) =>
        owner.readProjectionStatus({ env: databaseOptions.env, sessionId }, abortSignal),
      );
    } finally {
      await execution.release();
    }
  }
  const pending = withOmnipolymathAgentDatabaseReadOnly(
    ({ db }) => sessionTranscriptIndexNeedsReconcile(db, sessionId),
    databaseOptions,
  );
  return pending.found && pending.value;
}
