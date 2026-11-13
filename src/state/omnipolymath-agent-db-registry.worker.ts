import { assertDatabasePathIdentity } from "../infra/sqlite-worker-identity.js";
import {
  deferSqliteWorkerCommitReceipt,
  requestSqliteWorkerOperationAdmission,
} from "../infra/sqlite-worker-operation-admission.js";
import type { AgentDatabaseRegistryWorkerOperations } from "./omnipolymath-agent-db-contract.js";
import { unregisterOmnipolymathAgentDatabase } from "./omnipolymath-agent-db-registry.js";
import { requireOmnipolymathStateDatabaseIdentity } from "./omnipolymath-state-db-cache.js";
import { runOmnipolymathStateWriteTransaction } from "./omnipolymath-state-db.js";
import type { WorkerOperationHandlers } from "./worker-operation-registry.js";

export const agentDatabaseRegistryOperations = {
  "agentDatabaseRegistry.remove": (
    input: AgentDatabaseRegistryWorkerOperations["agentDatabaseRegistry.remove"]["input"],
    { stateOptions },
  ) => {
    const options = stateOptions();
    return runOmnipolymathStateWriteTransaction((database) => {
      requestSqliteWorkerOperationAdmission({ stage: "transaction", facts: undefined });
      assertDatabasePathIdentity(input.agentPath, input.identity);
      unregisterOmnipolymathAgentDatabase({
        agentId: input.agentId,
        path: input.agentPath,
        env: options.env,
      });
      requestSqliteWorkerOperationAdmission({ stage: "commit", facts: undefined });
      const receipt = {
        agentId: input.agentId,
        agentPath: input.agentPath,
        stateDatabasePath: database.path,
        stateDatabaseIdentity: requireOmnipolymathStateDatabaseIdentity(database).key,
      };
      deferSqliteWorkerCommitReceipt(database.db, receipt);
      return receipt;
    }, options);
  },
} satisfies WorkerOperationHandlers;
