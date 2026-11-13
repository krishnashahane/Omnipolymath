import type { OmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.types.js";
import type { CronRunReceiptHandle } from "./store/run-receipt.types.js";

/** Existing run and Gateway checks carried to standing-grant consumption. */
export type CronStandingGrantAuthority = {
  context: OmnipolymathStateWorkerContext;
  handle: CronRunReceiptHandle;
  assertCurrent: () => void;
};
