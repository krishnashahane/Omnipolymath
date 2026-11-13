import {
  executeExistingOmnipolymathStateRead,
  withArtifactPreservingStateReads,
} from "../state/omnipolymath-state-db-readonly.js";
import type { OmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.types.js";
import { runOmnipolymathStateWorkerOperation } from "../state/omnipolymath-state-worker-store.js";
import { createSqliteWorkerWriteAdmission } from "./sqlite-worker-store.js";
import type { UpdateRunLedgerOptions } from "./update-run-codec.js";
import type { InterruptedUpdateSettlement } from "./update-run-interruption-contract.js";

export async function readInterruptedUpdateCandidateAsync(
  options: UpdateRunLedgerOptions,
  context?: OmnipolymathStateWorkerContext,
) {
  const reply = await withArtifactPreservingStateReads(() =>
    executeExistingOmnipolymathStateRead(
      options,
      { type: "updateRuns.interruptedCandidate" },
      { context, preferIndependentWarmRead: true },
    ),
  );
  if (!reply) {
    return undefined;
  }
  return reply.run;
}

export function persistInterruptedUpdateObservationAsync(
  context: OmnipolymathStateWorkerContext,
  input: InterruptedUpdateSettlement,
  signal?: AbortSignal,
) {
  const assertCurrent = () => {
    context.admission.assertCurrent();
    signal?.throwIfAborted();
  };
  return runOmnipolymathStateWorkerOperation(
    context,
    (scope) => scope.execute({ type: "updateRuns.reconcileInterrupted", input }),
    {
      existingOnly: true,
      assertCurrent,
      createAdmission: createSqliteWorkerWriteAdmission(assertCurrent, [
        context.admission.databasePath,
      ]),
    },
  );
}
