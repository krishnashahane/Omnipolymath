import { createSqliteWorkerWriteAdmission } from "../infra/sqlite-worker-store.js";
import type { StateSchemaPublicationBlocker } from "./omnipolymath-state-schema-publication.js";
import { captureOmnipolymathStateWorkerContext } from "./omnipolymath-state-worker-context.js";
import { runOmnipolymathStateWorkerOperation } from "./omnipolymath-state-worker-store.js";

/** Publish deferred schema metadata through the existing shared-state writer. */
export function reconcileOmnipolymathStateSchemaPublicationAsync(
  options: { path?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {},
): Promise<StateSchemaPublicationBlocker | undefined> {
  const context = captureOmnipolymathStateWorkerContext(options);
  return runOmnipolymathStateWorkerOperation(
    context,
    (scope) => scope.execute({ type: "database.publishSchema", input: undefined }),
    {
      existingOnly: true,
      signal: options.signal,
      createAdmission: createSqliteWorkerWriteAdmission(context.admission.assertCurrent, [
        context.admission.databasePath,
      ]),
    },
  );
}
