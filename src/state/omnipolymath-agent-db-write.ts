import type { DatabaseSync } from "node:sqlite";
import { isPromiseLike } from "@omnipolymath/normalization-core/promise-like";
import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import { resolveStateDir } from "../config/state-dir.js";
import { assertExistingDatabaseIdentity } from "../infra/sqlite-worker-identity.js";
import { waitForAgentDatabaseWriteAdmission } from "./agent-database-preparation-context.js";
import { retainAgentDatabase } from "./omnipolymath-agent-db-borrower.js";
import type {
  OmnipolymathAgentDatabase,
  OmnipolymathAgentDatabaseOptions,
} from "./omnipolymath-agent-db-contract.js";
import { readOmnipolymathAgentDatabaseIdentity } from "./omnipolymath-agent-db-identity.js";
import {
  getOmnipolymathAgentDatabaseIfOpen,
  withOmnipolymathAgentDatabaseRuntime,
} from "./omnipolymath-agent-db.js";
import { resolveOmnipolymathAgentSqlitePath } from "./omnipolymath-agent-db.paths.js";
import { runOmnipolymathAgentWriteAdmission } from "./omnipolymath-agent-write-admission.js";

/** Admit a synchronous mutation without blocking a reclamation worker's parent callback. */
export async function withOmnipolymathAgentDatabaseWrite<T>(
  inputOptions: OmnipolymathAgentDatabaseOptions,
  operation: (database: OmnipolymathAgentDatabase) => T,
  expectedDatabase?: DatabaseSync,
  signal?: AbortSignal,
): Promise<T> {
  const options = {
    ...inputOptions,
    env: cloneEnvWithPlatformSemantics(inputOptions.env ?? process.env),
  };
  // Relative paths and legacy-root discovery must not retarget a queued operation.
  options.env.OMNIPOLYMATH_STATE_DIR = resolveStateDir(options.env);
  const pathname = resolveOmnipolymathAgentSqlitePath(options);
  options.path = pathname;
  const preparation = waitForAgentDatabaseWriteAdmission(options.agentId, {
    env: options.env,
    signal,
  });
  if (preparation) {
    await preparation;
  }
  const run = async (database: OmnipolymathAgentDatabase): Promise<T> => {
    const { identity, birthtime } = readOmnipolymathAgentDatabaseIdentity(database);
    assertExistingDatabaseIdentity(pathname, `file:${identity}`, birthtime);
    const result = operation(database);
    if (isPromiseLike(result)) {
      // A malformed callback must not leave an admitted tail writing after the
      // queue is released, even though asynchronous mutations are unsupported.
      await result;
      throw new Error("Agent database write callbacks must remain synchronous");
    }
    return result;
  };
  return runOmnipolymathAgentWriteAdmission(
    options,
    async (_identity, assertCurrent) => {
      if (!expectedDatabase) {
        return await withOmnipolymathAgentDatabaseRuntime(options, run, assertCurrent);
      }
      const database = getOmnipolymathAgentDatabaseIfOpen(options);
      if (!database || database.db !== expectedDatabase || !expectedDatabase.isOpen) {
        throw new Error("Borrowed agent database closed or changed before write admission");
      }
      const release = retainAgentDatabase(expectedDatabase);
      try {
        // Handle identity is not permission: the caller checks its live manager
        // and run authority in operation, after this wait and before mutation.
        return await run(database);
      } finally {
        release();
      }
    },
    true,
    undefined,
    signal,
  );
}
