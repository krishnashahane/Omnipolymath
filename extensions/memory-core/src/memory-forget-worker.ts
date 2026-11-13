import { createLazyRuntimeModule } from "omnipolymath/plugin-sdk/lazy-runtime";
import { resolveRuntimeWorkerUrl } from "omnipolymath/plugin-sdk/process-runtime";
import {
  openOmnipolymathAgentSqliteWorkerStoreV2,
  resolveOmnipolymathAgentSqlitePath,
  type OmnipolymathAgentDatabaseExecution,
  type SqliteWorkerStore,
} from "omnipolymath/plugin-sdk/sqlite-runtime";
import type {
  MemoryEntryOriginBinding,
  MemoryEntryOriginOperations,
} from "./memory-entry-origins-task.js";
import { withMemoryIndexGeneration } from "./memory/manager-index-generation-lease.js";

const loadEntrypoints = createLazyRuntimeModule(
  () => import("./memory/manager-cpu-entrypoints.js"),
);

/** Keep Forget's retained executor current across replans and every worker grant. */
export async function withMemoryForgetWorker<T>(
  options: Parameters<typeof openOmnipolymathAgentSqliteWorkerStoreV2>[0],
  execution: OmnipolymathAgentDatabaseExecution,
  input: Extract<MemoryEntryOriginBinding, { kind: "forget" }>,
  operation: (scope: Pick<SqliteWorkerStore<MemoryEntryOriginOperations>, "execute">) => Promise<T>,
): Promise<T> {
  const { memoryCpuProcessEntrypoints } = await loadEntrypoints();
  const assertCurrent = () => execution.assertCurrent();
  const worker = await openOmnipolymathAgentSqliteWorkerStoreV2<MemoryEntryOriginOperations>(
    options,
    { version: 2, assertCurrent },
    {
      moduleUrl: resolveRuntimeWorkerUrl(memoryCpuProcessEntrypoints.entryOrigins),
      input,
    },
  );
  try {
    await worker.prepare();
    return await withMemoryIndexGeneration(
      resolveOmnipolymathAgentSqlitePath(options),
      "mutation",
      () => worker.run(operation, assertCurrent),
    );
  } finally {
    await worker.close();
  }
}
