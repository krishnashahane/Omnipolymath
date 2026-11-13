import { assertSessionEntriesCurrentAdmission } from "../config/sessions/session-entry-current-admission.js";
import type { SessionEntriesCurrentCheck } from "../config/sessions/session-entry-current.types.js";
import { createSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import type { OmnipolymathStateDatabaseOptions } from "../state/omnipolymath-state-db.js";
import type { OmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.types.js";
import { runOmnipolymathStateWorkerOperation } from "../state/omnipolymath-state-worker-store.js";

export type SessionWatchOptions = Pick<OmnipolymathStateDatabaseOptions, "path" | "env"> & {
  now?: number;
  assertCurrent?: () => void;
  sessionEntriesCurrent?: SessionEntriesCurrentCheck;
};

export function runSessionWatchOperation<T>(
  context: OmnipolymathStateWorkerContext,
  operation: Parameters<typeof runOmnipolymathStateWorkerOperation<T>>[1],
  assertCurrent: () => void,
  sessionEntriesCurrent?: SessionEntriesCurrentCheck,
): Promise<T> {
  return runOmnipolymathStateWorkerOperation(context, operation, {
    assertCurrent,
    createAdmission: () => ({
      nativeLocations: [context.admission.databasePath],
      admission: createSqliteWorkerOperationAdmission((request, grant) => {
        if (
          request.stage !== "prepare" &&
          request.stage !== "transaction" &&
          request.stage !== "commit"
        ) {
          throw new Error("Session watch operation requires worker admission");
        }
        context.admission.assertCurrent();
        assertSessionEntriesCurrentAdmission(request, sessionEntriesCurrent);
        assertCurrent();
        grant();
      }),
    }),
  });
}
