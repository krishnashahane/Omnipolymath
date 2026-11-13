import { isPostgresSqlConnection, type EngineConnection } from "../infra/sql-connection.js";
import { sqlitePrimaryResultCode } from "../infra/sqlite-error-diagnostics.js";
import { collectSqliteSchemaIssues } from "../infra/sqlite-schema-contract.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { AGENT_SCHEMA_COMPATIBILITY } from "./omnipolymath-agent-db-schema-compatibility.js";
import { OMNIPOLYMATH_AGENT_SCHEMA_SQL } from "./omnipolymath-agent-schema.js";
import { SessionMetadataUnavailableError } from "./session-metadata-unavailable-error.js";

const settledReadOpenFailures = resolveGlobalSingleton(
  Symbol.for("omnipolymath.agentDatabaseSettledReadOpenFailures"),
  () => new WeakSet<object>(),
);

/** Only the native open owner can classify an unreadable store after successful cleanup. */
export function recordOmnipolymathAgentDatabaseReadOpenFailure(error: unknown): void {
  if (error !== null && typeof error === "object" && sqlitePrimaryResultCode(error) !== undefined) {
    settledReadOpenFailures.add(error);
  }
}

export function isOmnipolymathAgentDatabaseReadOpenFailure(error: unknown): boolean {
  return error !== null && typeof error === "object" && settledReadOpenFailures.has(error);
}

/** Record schema-owner facts after a failed query or admission, never infer them from error prose. */
export function classifyOmnipolymathAgentDatabaseReadError(
  db: EngineConnection,
  error: unknown,
): unknown {
  if (isPostgresSqlConnection(db)) {
    return error;
  }
  try {
    const missingTables = collectSqliteSchemaIssues(
      db,
      OMNIPOLYMATH_AGENT_SCHEMA_SQL,
      AGENT_SCHEMA_COMPATIBILITY,
    )
      .filter((issue) => issue.code === "missing-table")
      .map((issue) => issue.objectName);
    return missingTables.length > 0
      ? new SessionMetadataUnavailableError("table-missing", { cause: error }, missingTables)
      : error;
  } catch {
    return error;
  }
}
