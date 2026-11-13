import { executeSqliteQueryTakeFirstSync, getNodeSqliteKysely } from "../../infra/kysely-sync.js";
import type { OmnipolymathAgentDatabase } from "../../state/omnipolymath-agent-db-contract.js";
import type { DB } from "../../state/omnipolymath-agent-db.generated.js";

/** Physical hot rows only; a retained cold archive does not satisfy this probe. */
export function hasStoredTranscriptEvents(
  database: Pick<OmnipolymathAgentDatabase, "db">,
  sessionId: string,
): boolean {
  return Boolean(
    executeSqliteQueryTakeFirstSync(
      database.db,
      getNodeSqliteKysely<DB>(database.db)
        .selectFrom("transcript_events")
        .select("seq")
        .where("session_id", "=", sessionId)
        .limit(1),
    ),
  );
}
