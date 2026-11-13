import type { DatabaseSync } from "node:sqlite";
import type { SqliteIntegrityOperation } from "../infra/sqlite-integrity.js";
import { readSqliteUserVersion } from "../infra/sqlite-user-version.js";
import { configureSqlitePreSchemaPragmas } from "../infra/sqlite-wal.js";
import { normalizeAgentId } from "../routing/session-key.js";
import {
  AGENT_MEDIA_SCHEMA_VERSION,
  type OmnipolymathAgentDatabaseOptions,
} from "./omnipolymath-agent-db-contract.js";
import * as maintenanceAuthority from "./omnipolymath-agent-db-lease.js";
import {
  assertExistingAgentSchemaOwner,
  readExistingAgentSchemaMeta,
} from "./omnipolymath-agent-db-schema-helpers.js";
import {
  agentDatabaseIntegrityBeforeMutationSteps,
  ensureOmnipolymathAgentSchema,
} from "./omnipolymath-agent-db-schema.js";
import { assertSupportedAgentMigrationSchemas } from "./omnipolymath-agent-db-session-migrations.js";
import { resolveOmnipolymathAgentSqlitePath } from "./omnipolymath-agent-db.paths.js";
import { OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS } from "./omnipolymath-state-db-contract.js";

/** Upgrade older owned databases to the structural schema required by the media cutover. */
export function* migrateOmnipolymathAgentDatabaseToMediaPrerequisiteSchemaSteps(
  db: DatabaseSync,
  options: OmnipolymathAgentDatabaseOptions & { integrityCheck?: "quick" | "full" },
): SqliteIntegrityOperation<void> {
  const targetVersion = AGENT_MEDIA_SCHEMA_VERSION - 1;
  const userVersion = readSqliteUserVersion(db);
  if (userVersion > targetVersion) {
    return;
  }
  const agentId = normalizeAgentId(options.agentId);
  const pathname = resolveOmnipolymathAgentSqlitePath({ ...options, agentId });
  assertExistingAgentSchemaOwner(readExistingAgentSchemaMeta(db), agentId, pathname);
  assertSupportedAgentMigrationSchemas(db, pathname, userVersion);
  if (db.location()) {
    maintenanceAuthority.invalidateOmnipolymathAgentDatabaseIntegrityBeforeMutation(pathname);
  }
  yield* agentDatabaseIntegrityBeforeMutationSteps(db, agentId, pathname, {
    integrityCheck: options.integrityCheck,
  });
  configureSqlitePreSchemaPragmas(db, {
    busyTimeoutMs: OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS,
  });
  ensureOmnipolymathAgentSchema(
    db,
    agentId,
    pathname,
    targetVersion,
    undefined,
    undefined,
    false,
    options.integrityCheck,
  );
}
