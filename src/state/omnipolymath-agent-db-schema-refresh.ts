import { isPostgresSqlConnection } from "../infra/sql-connection.js";
import {
  readSqliteDatabaseIntegrityVerification,
  settleSqliteDatabaseAdmissionPublication,
} from "../infra/sqlite-database-admission.js";
import { runSqliteIntegrityOperationSync } from "../infra/sqlite-integrity.js";
import { runSqliteSchemaReadSnapshotSync } from "../infra/sqlite-pinned-read-snapshot.js";
import {
  admitSqliteSchema,
  adoptSqliteSchemaFacts,
  getAdmittedSqliteSchemaFacts,
  runSqliteReadOperationSync,
} from "../infra/sqlite-schema-facts.js";
import { AgentDatabaseSchemaAdmissionChangedError } from "./agent-database-admission-error.js";
import { assertCanonicalSessionValidationSchema } from "./omnipolymath-agent-canonical-validation-schema.js";
import type { OmnipolymathAgentDatabase } from "./omnipolymath-agent-db-contract.js";
import {
  assertSupportedAgentSchemaVersion,
  assertCurrentAgentSchemaMetadata,
  assertCanonicalAgentPersistenceVersion,
  readExistingAgentSchemaMeta,
} from "./omnipolymath-agent-db-schema-read.js";
import {
  agentDatabaseIntegrityBeforeMutationSteps,
  ensureOmnipolymathAgentSchema,
} from "./omnipolymath-agent-db-schema.js";
import {
  adoptOmnipolymathAgentDatabaseSchema,
  getOmnipolymathAgentDatabaseValidation,
  invalidateOmnipolymathAgentDatabaseSchema,
  invalidateOmnipolymathAgentDatabaseValidation,
  setOmnipolymathAgentDatabaseValidation,
} from "./omnipolymath-agent-db-validation-cache.js";

/** Re-admit the retained connection without replacing its native generation or lease. */
export function refreshOmnipolymathAgentDatabaseSchema(
  database: OmnipolymathAgentDatabase,
  assertCurrent: () => void,
  runtimeAdmission = true,
) {
  const { db, agentId, path: pathname } = database;
  assertCurrent();
  if (db.isTransaction) {
    throw new Error("Agent schema admission requires a settled writer");
  }
  if (isPostgresSqlConnection(db)) {
    const validation = getOmnipolymathAgentDatabaseValidation(database);
    if (!validation || !adoptOmnipolymathAgentDatabaseSchema(database)) {
      throw new Error("Agent PostgreSQL schema admission changed; reopen the database");
    }
    return validation;
  }
  try {
    const reused = runSqliteReadOperationSync(db, () => {
      assertSupportedAgentSchemaVersion(db, pathname);
      assertCurrentAgentSchemaMetadata(readExistingAgentSchemaMeta(db), agentId, pathname);
      const validation = getOmnipolymathAgentDatabaseValidation(database);
      return validation && adoptOmnipolymathAgentDatabaseSchema(database) ? validation : undefined;
    });
    const verification = readSqliteDatabaseIntegrityVerification(db);
    if (reused && (runtimeAdmission || verification)) {
      return reused;
    }
    const validation = getOmnipolymathAgentDatabaseValidation(database);
    invalidateOmnipolymathAgentDatabaseSchema(database);
    const convergence = runSqliteIntegrityOperationSync(
      agentDatabaseIntegrityBeforeMutationSteps(db, agentId, pathname, {
        runtimeAdmission,
        verification,
        reuseRuntimeIntegrity: Boolean(validation),
      }),
      assertCurrent,
    );
    assertCanonicalAgentPersistenceVersion(db, pathname);
    if (convergence) {
      ensureOmnipolymathAgentSchema(db, agentId, pathname);
    }
    // Integrity admission or same-version repair already checked the runtime schema.
    const checkedSchema = runSqliteSchemaReadSnapshotSync(db, () => {
      admitSqliteSchema(db);
      assertCanonicalSessionValidationSchema(db);
      assertCurrent();
      return getAdmittedSqliteSchemaFacts(db);
    });
    // Release the pin before host publication, retaining only the catalog we checked.
    if (!checkedSchema || !adoptSqliteSchemaFacts(db, checkedSchema)) {
      throw new AgentDatabaseSchemaAdmissionChangedError();
    }
    assertCurrent();
    const refreshed = setOmnipolymathAgentDatabaseValidation(database);
    if (!settleSqliteDatabaseAdmissionPublication(db)) {
      throw new Error("Agent schema publication requires a settled connection");
    }
    return refreshed;
  } catch (error) {
    invalidateOmnipolymathAgentDatabaseValidation(pathname);
    throw error;
  }
}
