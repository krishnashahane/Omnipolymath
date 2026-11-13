import { isPostgresSqlConnection, type EngineConnection } from "../infra/sql-connection.js";
import {
  AGENT_PROGRESS_CARD_SCHEMA_SQL,
  SESSION_PROGRESS_CARDS_TABLE,
} from "./omnipolymath-agent-schema-history.js";
import { tableExists } from "./omnipolymath-state-db-schema-helpers.js";

export {
  AGENT_PROGRESS_CARD_SCHEMA_SQL,
  SESSION_PROGRESS_CARDS_TABLE,
} from "./omnipolymath-agent-schema-history.js";

/** Ensure the additive progress-card table inside the caller's write transaction. */
export function ensureOmnipolymathAgentProgressCardSchemaInTransaction(db: EngineConnection): void {
  if (!db.isTransaction) {
    throw new Error("progress-card schema ensure requires an active transaction");
  }
  if (isPostgresSqlConnection(db) || tableExists(db, SESSION_PROGRESS_CARDS_TABLE)) {
    return;
  }
  db.exec(AGENT_PROGRESS_CARD_SCHEMA_SQL); // sqlite-allow-raw -- Canonical DDL bootstrap for the lazy progress-card schema.
}
