import { isPostgresSqlConnection, type EngineConnection } from "../infra/sql-connection.js";
import { createSqliteSchemaEnsurer } from "../infra/sqlite-schema-ensure.js";
import { extractSqliteTableSchema } from "../infra/sqlite-schema-sql.js";
import { OMNIPOLYMATH_AGENT_SCHEMA_SQL } from "./omnipolymath-agent-schema.js";

export const SESSION_TRANSCRIPT_ARCHIVES_TABLE = "session_transcript_archives";

const ensureNativeSessionTranscriptArchiveSchema = createSqliteSchemaEnsurer(
  () =>
    extractSqliteTableSchema(OMNIPOLYMATH_AGENT_SCHEMA_SQL, SESSION_TRANSCRIPT_ARCHIVES_TABLE, {
      endMarker: "CREATE TABLE IF NOT EXISTS transcript_rewrite_watermarks (",
      includeEndMarker: false,
      errorMessage: "Omnipolymath session transcript archive schema markers are missing.",
    }),
  {
    tables: [SESSION_TRANSCRIPT_ARCHIVES_TABLE, "session_transcript_cold_archives"],
    indexes: [
      "idx_agent_session_transcript_archives_pending",
      "idx_agent_session_transcript_archives_retention",
    ],
  },
);

/** Lazily installs SQLite archives; PostgreSQL admits them with the agent schema. */
export function ensureSessionTranscriptArchiveSchema(database: EngineConnection): void {
  if (!isPostgresSqlConnection(database)) {
    ensureNativeSessionTranscriptArchiveSchema(database);
  }
}
