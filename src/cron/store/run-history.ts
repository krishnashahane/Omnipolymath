import { captureOmnipolymathStateWorkerContext } from "../../state/omnipolymath-state-worker-context.js";
import type { OmnipolymathStateWorkerContext } from "../../state/omnipolymath-state-worker-context.types.js";
import { runOmnipolymathStateWorkerOperation } from "../../state/omnipolymath-state-worker-store.js";
import { listActiveCronJobIds } from "../active-jobs.js";
import { runCronRuntimeMutation } from "../service/runtime-mutation.js";
import type { CronRunHistoryWrite } from "./run-history.types.js";

/** Captured storage context and attribution for an already-committed outcome. */
export type CronRunHistorySource = {
  context: OmnipolymathStateWorkerContext;
  storeKey: string;
  defaultAgentId?: string;
};

export async function maintainCronRunHistory(
  context: OmnipolymathStateWorkerContext,
  assertCurrent: () => void,
): Promise<{ nextSweepAtMs: number | null }> {
  let nextSweepAtMs: number | null = null;
  await runCronRuntimeMutation({
    context,
    type: "cron.maintainHistory",
    input: {},
    assertCurrent,
    snapshot: {
      nowMs: Date.now(),
      protectedJobIds: listActiveCronJobIds(),
    },
    publish(outcome) {
      nextSweepAtMs = outcome.nextSweepAtMs;
    },
  });
  return { nextSweepAtMs };
}

export async function recordCronRun(
  input: CronRunHistoryWrite,
  source?: CronRunHistorySource,
): Promise<void> {
  const context = source?.context ?? captureOmnipolymathStateWorkerContext();
  // Caller retirement after dispatch may race history; committed outcomes remain useful.
  await runOmnipolymathStateWorkerOperation(context, (scope) =>
    scope.execute({ type: "cron.recordRun", input }),
  );
}
