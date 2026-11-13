import { createSessionWorkerExecutionSource } from "../config/sessions/session-worker-execution-source.js";
import { isPostgresSqlConnection } from "../infra/sql-connection.js";
import { registerSqliteWalWorkerMaintenance } from "../infra/sqlite-wal-write-admission.js";
import { retainAgentDatabase } from "./omnipolymath-agent-db-borrower.js";
import type { OmnipolymathAgentDatabase } from "./omnipolymath-agent-db-contract.js";
import { readOmnipolymathAgentDatabaseIdentity } from "./omnipolymath-agent-db-identity.js";
import { agentDatabaseLifecycle } from "./omnipolymath-agent-db-lifecycle.js";
import { registerOmnipolymathAgentDatabaseAsyncResource } from "./omnipolymath-agent-db-resources.js";
import { runOmnipolymathAgentWorkerWrite } from "./omnipolymath-agent-write-admission.js";

/** Keep the published timer's exact native owner pinned through worker settlement. */
export function registerOmnipolymathAgentWalMaintenance(
  database: OmnipolymathAgentDatabase,
  env: NodeJS.ProcessEnv,
): void {
  if (isPostgresSqlConnection(database.db)) {
    return;
  }
  const options = { agentId: database.agentId, path: database.path, env };
  const identity = readOmnipolymathAgentDatabaseIdentity(database);
  const expectedIdentity = {
    kind: "file" as const,
    physicalIdentity: identity.identity,
    birthtime: identity.birthtime,
    nativeLocation: identity.filename,
  };
  const controller = new AbortController();
  let pending: Promise<unknown> | undefined;
  let unregister: (() => void) | undefined;
  const cancel = () => {
    controller.abort();
  };
  const assertCurrent = () => {
    controller.signal.throwIfAborted();
    if (agentDatabaseLifecycle.databases.get(database.path) !== database || !database.db.isOpen) {
      throw new Error("Agent WAL maintenance owner changed");
    }
  };
  registerSqliteWalWorkerMaintenance(
    database.db,
    async (request) => {
      if (controller.signal.aborted) {
        return undefined;
      }
      const release = retainAgentDatabase(database.db);
      const active = runOmnipolymathAgentWorkerWrite(
        options,
        async () => {
          assertCurrent();
          unregister = registerOmnipolymathAgentDatabaseAsyncResource({
            ...options,
            revoke: cancel,
            async close() {
              cancel();
              await pending?.catch(() => {});
            },
          });
          const { captureOmnipolymathAgentDatabaseExecution } =
            await import("./omnipolymath-agent-execution.js");
          assertCurrent();
          const execution = captureOmnipolymathAgentDatabaseExecution(options, { expectedIdentity });
          try {
            const result = await execution.runExisting(
              createSessionWorkerExecutionSource(
                assertCurrent,
                "Agent WAL maintenance authority expired",
              ),
              (worker) => worker.execute({ type: "database.walMaintenance", input: request }),
            );
            assertCurrent();
            execution.assertCurrent();
            return result;
          } finally {
            await execution.release();
          }
        },
        undefined,
        controller.signal,
      );
      pending = active;
      try {
        return await active;
      } finally {
        release();
        pending = undefined;
        unregister?.();
        unregister = undefined;
      }
    },
    cancel,
  );
}
