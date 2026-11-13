import {
  resolveStateDir,
  resolveUserPath,
} from "omnipolymath/plugin-sdk/memory-core-host-engine-foundation";
import type {
  readOmnipolymathAgentDatabaseIdentity,
  openOmnipolymathAgentSqliteWorkerStoreV2,
} from "omnipolymath/plugin-sdk/sqlite-runtime";
import type { MemoryDatabaseFacts } from "./manager-retrieval-read.js";

/** Facts published by the worker that admitted the physical index. */
export type MemoryDatabaseAdmission = {
  engine?: "postgres";
  hasIndex: boolean;
  ftsAvailable: boolean;
  identity?: ReturnType<typeof readOmnipolymathAgentDatabaseIdentity>;
  facts?: MemoryDatabaseFacts;
};

export type MemoryDatabaseOpenOptions = {
  agentId: string;
  writeOptions: Parameters<typeof openOmnipolymathAgentSqliteWorkerStoreV2>[0] & { path: string };
  readOnly: boolean;
  allowExtension: boolean;
  maintenanceSource?: import("./manager-database-context.js").MemoryIndexDatabase;
  schema: import("./manager-publication-task.js").MemoryPublicationOperations["schema.admit"]["input"];
};

export function captureMemoryDatabaseWriteOptions(
  agentId: string,
  databasePath: string,
  source?: MemoryDatabaseOpenOptions["maintenanceSource"],
) {
  const env = { ...(source?.writeOptions?.env ?? process.env) };
  env.OMNIPOLYMATH_STATE_DIR = resolveStateDir(env);
  return {
    agentId,
    path: source?.writeOptions?.path ?? resolveUserPath(databasePath),
    env,
  };
}
