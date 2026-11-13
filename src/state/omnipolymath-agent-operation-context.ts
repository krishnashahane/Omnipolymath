import type { Transferable } from "node:worker_threads";
import type { SqliteTransactionOptions } from "../infra/sqlite-transaction.js";
import type { DatabasePathIdentity } from "../infra/sqlite-worker-identity.js";
import type {
  OmnipolymathAgentDatabase,
  OmnipolymathAgentDatabaseOptions,
} from "./omnipolymath-agent-db-contract.js";
import type { OmnipolymathStateDatabase } from "./omnipolymath-state-db-contract.js";

export type AgentWorkerOperationContext = {
  open: () => OmnipolymathAgentDatabase;
  options: OmnipolymathAgentDatabaseOptions & { path: string };
  admit: (
    stage: "prepare" | "transaction" | "commit",
    publication?: unknown,
    transferList?: Transferable[],
  ) => void;
  writeTransaction: <T>(
    operationLabel: string,
    owner: string,
    write: (current: OmnipolymathAgentDatabase) => T,
    diagnosticContext?: SqliteTransactionOptions["diagnosticContext"],
    /** The owner prepared its receipt and final admission before one terminal statement. */
    singleStatement?: boolean,
  ) => T;
  /** Durable executors lend their exact admitted shared owner to native binding settlement. */
  writeSharedTransaction?: <T>(
    source: DatabasePathIdentity,
    write: (current: OmnipolymathStateDatabase) => T,
  ) => T;
};
