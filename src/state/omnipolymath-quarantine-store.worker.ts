import { requestSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import { recordOmnipolymathDatabaseQuarantine } from "./omnipolymath-quarantine-store.js";
import type { WorkerOperationContext } from "./worker-operation-registry.js";

export const quarantineOperations = {
  "quarantine.record": (
    input: { pathname: string; reason: string },
    context: WorkerOperationContext,
  ) => {
    context.open();
    recordOmnipolymathDatabaseQuarantine(input.pathname, input.reason, {
      env: context.stateOptions().env,
      assertCurrent: () =>
        requestSqliteWorkerOperationAdmission({ stage: "commit", facts: undefined }),
    });
  },
};
