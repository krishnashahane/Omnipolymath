import { readDatabasePathIdentitySync } from "../../infra/sqlite-worker-identity.js";
import type { OmnipolymathAgentDatabaseOptions } from "../../state/omnipolymath-agent-db-contract.js";
import { toAgentExecutionConstraints } from "../../state/omnipolymath-agent-execution-scope.js";
import { captureOmnipolymathAgentDatabaseExecution } from "../../state/omnipolymath-agent-execution.js";

/** Pin an existing inode before preparation yields; the executor owns first creation. */
export function captureAuthProfileWriteExecution(
  target: OmnipolymathAgentDatabaseOptions & { path: string },
) {
  const identity = readDatabasePathIdentitySync(target.path);
  return captureOmnipolymathAgentDatabaseExecution(
    target,
    identity.key.startsWith("file:") ? toAgentExecutionConstraints(identity) : {},
  );
}
