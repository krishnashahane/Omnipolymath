import { withEngineStoreAdmission } from "../../infra/database-engine/admission-scope.js";
import { normalizeMainKey } from "../../routing/session-key.js";
import {
  OMNIPOLYMATH_AGENT_SCHEMA_VERSION,
  type OmnipolymathAgentDatabaseOptions,
} from "../../state/omnipolymath-agent-db-contract.js";
import { withOmnipolymathAgentDatabaseReadOnly } from "../../state/omnipolymath-agent-db-readonly.js";
import { readAgentDatabaseSchemaVersion } from "../../state/omnipolymath-agent-db-schema-read.js";
import { readStoredCanonicalSessionMainKey } from "./session-canonical-key.js";

/** Checks the startup contract without joining the writable database lifecycle. */
export function isCanonicalSqliteSessionMainKeyCurrent(
  options: OmnipolymathAgentDatabaseOptions,
  mainKey: string | undefined,
): boolean {
  const canonicalMainKey = normalizeMainKey(mainKey);
  const result = withEngineStoreAdmission(() =>
    withOmnipolymathAgentDatabaseReadOnly((database) => {
      if (readAgentDatabaseSchemaVersion(database.db) !== OMNIPOLYMATH_AGENT_SCHEMA_VERSION) {
        return false;
      }
      return readStoredCanonicalSessionMainKey(database, database.agentId) === canonicalMainKey;
    }, options),
  );
  return result.found && result.value;
}
