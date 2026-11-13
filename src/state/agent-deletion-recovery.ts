import { createSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import type { AgentDeletionRecoveryHoldPredicate } from "./agent-deletion-journal-recovery.kernel.js";
import { captureOmnipolymathStateWorkerContext } from "./omnipolymath-state-worker-context.js";
import { runOmnipolymathStateWorkerOperation } from "./omnipolymath-state-worker-store.js";

/** Resolve the captured recovery holds while creation retains its original path authority. */
export async function resolveAgentDeletionRecoveryHoldsInWorker(
  predicate: AgentDeletionRecoveryHoldPredicate,
  paths: string[],
  assertCurrent: () => void,
): Promise<void> {
  const context = captureOmnipolymathStateWorkerContext();
  const input = { predicate, paths };
  await runOmnipolymathStateWorkerOperation(
    context,
    (scope) => scope.execute({ type: "agentRecovery.resolveHolds", input }),
    {
      assertCurrent,
      createAdmission: () => ({
        nativeLocations: [context.admission.databasePath],
        admission: createSqliteWorkerOperationAdmission((request, grant) => {
          if (request.stage !== "transaction" && request.stage !== "commit") {
            throw new Error("Agent recovery requires transaction admission");
          }
          context.admission.assertCurrent();
          assertCurrent();
          grant();
        }),
      }),
    },
  );
}
