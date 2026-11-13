import { executeExistingOmnipolymathStateRead } from "../state/omnipolymath-state-db-readonly.js";
import type { OmnipolymathStateDatabaseOptions } from "../state/omnipolymath-state-db.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import type { OmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.types.js";
import { runOmnipolymathStateWorkerOperation } from "../state/omnipolymath-state-worker-store.js";
import type { CronScratchReadCommand, CronScratchSnapshot } from "./scratch-contract.js";
import { prepareMutableCronStoreKey } from "./store/paths.js";

type CronScratchReadAdmission = {
  context?: OmnipolymathStateWorkerContext;
  assertCurrent?: () => void;
  signal?: AbortSignal;
};

/** Keep first-use schema opening and the subsequent read on their existing workers. */
export async function readCronScratchSnapshot(
  storePath: string,
  selector: CronScratchReadCommand["selector"],
  options: Pick<OmnipolymathStateDatabaseOptions, "path" | "env"> = {},
  admission?: CronScratchReadAdmission,
): Promise<CronScratchSnapshot | undefined> {
  const context = admission?.context ?? captureOmnipolymathStateWorkerContext(options);
  const selected = { ...selector };
  const storeKey = await prepareMutableCronStoreKey(storePath, context, options.env);
  return readCronScratchSnapshotByKey(storeKey, selected, options, { ...admission, context });
}

/** Internal callers retain the opaque partition selected with their original admission. */
export async function readCronScratchSnapshotByKey(
  storeKey: string,
  selector: CronScratchReadCommand["selector"],
  options: Pick<OmnipolymathStateDatabaseOptions, "path" | "env"> = {},
  admission?: CronScratchReadAdmission,
): Promise<CronScratchSnapshot | undefined> {
  const context = admission?.context ?? captureOmnipolymathStateWorkerContext(options);
  const command: CronScratchReadCommand = {
    type: "cron.scratch",
    storeKey,
    selector: { ...selector },
  };
  const callerCurrent = admission?.assertCurrent;
  const signal = admission?.signal;
  const assertCurrent = () => {
    signal?.throwIfAborted();
    context.admission.assertCurrent();
    callerCurrent?.();
    context.admission.assertCurrent();
  };
  assertCurrent();
  // The old mutable getter initialized missing/older state. Native actor readiness
  // owns that opening; the independent reader never creates or migrates a schema.
  await runOmnipolymathStateWorkerOperation(context, async () => assertCurrent(), { assertCurrent });
  assertCurrent();
  const reply = await executeExistingOmnipolymathStateRead(
    { path: context.admission.databasePath, env: context.environment },
    command,
    { context, current: true, signal },
  );
  assertCurrent();
  if (!reply) {
    throw new Error("Cron scratch read did not return its admitted snapshot");
  }
  return reply.snapshot;
}
