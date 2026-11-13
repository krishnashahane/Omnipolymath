import { vi } from "vitest";
import * as stateWorker from "../../state/omnipolymath-state-worker-store.js";
import type { DomainScope } from "../../state/omnipolymath-state-worker-store.types.js";

type OperationOptions = Parameters<typeof stateWorker.runOmnipolymathStateWorkerOperation>[2];

export function interceptWorktreeWorkerOperation(
  intercept: (execute: DomainScope["execute"]) => DomainScope["execute"],
  configure?: (options: OperationOptions) => OperationOptions,
) {
  const run = stateWorker.runOmnipolymathStateWorkerOperation;
  return vi
    .spyOn(stateWorker, "runOmnipolymathStateWorkerOperation")
    .mockImplementation((context, operation, options) =>
      run(
        context,
        (scope) => operation({ execute: intercept(scope.execute.bind(scope)) }),
        configure ? configure(options) : options,
      ),
    );
}
