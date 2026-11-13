import { AsyncResource } from "node:async_hooks";

export function captureWorkerTaskContext(): <T>(operation: () => T) => T {
  // Other task callbacks must not share this closure and retain its caller after release.
  const context = new AsyncResource("Omnipolymath.WorkerTask");
  return (operation) => context.runInAsyncScope(operation);
}
