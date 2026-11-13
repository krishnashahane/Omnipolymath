import type { DatabaseSync } from "node:sqlite";
import { readSqliteDatabaseIntegrityVerification } from "../infra/sqlite-database-admission.js";
import {
  admitSqliteSchema,
  getAdmittedSqliteSchemaFacts,
  isSqliteSchemaAdmissionCold,
} from "../infra/sqlite-schema-facts.js";
import { assertCanonicalSessionValidationSchema } from "./omnipolymath-agent-canonical-validation-schema.js";
import { registerOmnipolymathAgentDatabaseIdentity } from "./omnipolymath-agent-db-identity.js";
import { setOmnipolymathAgentDatabaseValidation } from "./omnipolymath-agent-db-validation-cache.js";

/** Publish completed canonical schema admission from the still-open maintenance handle. */
export function admitOmnipolymathAgentDatabaseSchema(
  db: DatabaseSync,
  options: { agentId: string; path: string },
): DatabaseSync | undefined {
  // Quick migration coverage cannot publish full-integrity verification.
  if (
    db.location() &&
    readSqliteDatabaseIntegrityVerification(db) &&
    (isSqliteSchemaAdmissionCold(db) || getAdmittedSqliteSchemaFacts(db))
  ) {
    admitSqliteSchema(db);
    assertCanonicalSessionValidationSchema(db);
    registerOmnipolymathAgentDatabaseIdentity(db);
    setOmnipolymathAgentDatabaseValidation({ db, ...options });
    return db;
  }
  return undefined;
}
