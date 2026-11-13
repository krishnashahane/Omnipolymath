import { createDeferredCore } from "../../shared/deferred.js";
import { assertAgentDatabaseAdmitted } from "../../state/agent-database-admission.js";
import { retainAgentDatabase } from "../../state/omnipolymath-agent-db-borrower.js";
import { isOmnipolymathAgentDatabasePathCurrent } from "../../state/omnipolymath-agent-db-identity.js";
import { agentDatabaseLifecycle } from "../../state/omnipolymath-agent-db-lifecycle.js";
import { registerOmnipolymathAgentDatabaseAsyncResource } from "../../state/omnipolymath-agent-db-resources.js";
import type { OmnipolymathAgentDatabase } from "../../state/omnipolymath-agent-db.js";
import { getOmnipolymathDatabaseMaintenanceScope } from "../../state/omnipolymath-state-db-async-lifecycle.js";
import {
  captureOmnipolymathStateDatabaseReadAdmission,
  registerOmnipolymathStateDatabaseAsyncResource,
} from "../../state/omnipolymath-state-db-cache.js";
import { resolveOmnipolymathStateSqlitePath } from "../../state/omnipolymath-state-db.paths.js";
import type { SessionEntryCommitContext } from "./session-accessor.types.js";

/** Native-only scopes retain their original handle, not a pathname reopened after commit. */
export async function withNativeSessionCommitContext<T>(
  database: OmnipolymathAgentDatabase,
  env: NodeJS.ProcessEnv,
  commit: (source?: SessionEntryCommitContext) => T,
  afterCommitted?: (context: SessionEntryCommitContext) => Promise<void>,
): Promise<T> {
  if (!afterCommitted) {
    return commit();
  }
  if (database.db.isTransaction) {
    throw new Error("Session commit follow-up requires an outer transaction");
  }
  const capturedEnv = Object.freeze({ ...env });
  const state = captureOmnipolymathStateDatabaseReadAdmission(
    resolveOmnipolymathStateSqlitePath(capturedEnv),
  );
  const maintenance = getOmnipolymathDatabaseMaintenanceScope();
  const completion = createDeferredCore();
  let active = true;
  const revoke = () => {
    active = false;
  };
  const context: SessionEntryCommitContext = {
    env: capturedEnv,
    assertCurrent() {
      if (
        !active ||
        agentDatabaseLifecycle.databases.get(database.path) !== database ||
        !isOmnipolymathAgentDatabasePathCurrent(database)
      ) {
        throw new Error("Session commit owner is no longer current");
      }
      if (agentDatabaseLifecycle.failures.has(database.path)) {
        throw agentDatabaseLifecycle.failures.get(database.path);
      }
      state.assertCurrent();
      maintenance?.assertAdmission();
      assertAgentDatabaseAdmitted(database.agentId, { env: capturedEnv });
    },
  };
  context.assertCurrent();
  const release = retainAgentDatabase(database.db);
  let unregisterAgent: (() => void) | undefined;
  let unregisterState: (() => void) | undefined;
  try {
    unregisterAgent = registerOmnipolymathAgentDatabaseAsyncResource({
      agentId: database.agentId,
      path: database.path,
      revoke,
      close: () => completion.promise,
    });
    unregisterState = registerOmnipolymathStateDatabaseAsyncResource({
      admission: state,
      close: async () => {
        revoke();
        await completion.promise;
      },
    });
    const result = commit(context);
    await afterCommitted(context);
    return result;
  } finally {
    revoke();
    release();
    completion.resolve();
    unregisterAgent?.();
    unregisterState?.();
  }
}
