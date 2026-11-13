import { executeSqliteQuerySync, getNodeSqliteKysely } from "../../infra/kysely-sync.js";
import { groupPluginRecords as groupRecords } from "../../plugins/record-groups.js";
import type {
  DB as OmnipolymathAgentKyselyDatabase,
  SessionReactions,
} from "../../state/omnipolymath-agent-db.generated.js";
import type { OmnipolymathAgentDatabase } from "../../state/omnipolymath-agent-db.js";
import type { StoredMessageReactionSummary } from "./session-reaction-store.types.js";

export function reactionDb(database: Pick<OmnipolymathAgentDatabase, "db">) {
  return getNodeSqliteKysely<
    Pick<OmnipolymathAgentKyselyDatabase, "session_reactions" | "transcript_event_identities">
  >(database.db);
}

export function summarizeReactions(rows: SessionReactions[]): StoredMessageReactionSummary[] {
  const summaries = new Map<string, StoredMessageReactionSummary>();
  for (const row of rows) {
    let summary = summaries.get(row.emoji);
    if (!summary) {
      summary = { emoji: row.emoji, count: 0, identities: [] };
      summaries.set(row.emoji, summary);
    }
    summary.count += 1;
    summary.identities.push({
      id: row.identity_id,
      ...(row.identity_label ? { label: row.identity_label } : {}),
    });
  }
  return [...summaries.values()];
}

export function reactionRows(
  database: Pick<OmnipolymathAgentDatabase, "db">,
  sessionKey: string,
  sessionId: string,
) {
  return reactionDb(database)
    .selectFrom("session_reactions")
    .selectAll()
    .where("session_key", "=", sessionKey)
    .where("session_id", "=", sessionId)
    .orderBy("created_at")
    .orderBy("emoji")
    .orderBy("identity_id");
}

export function listSessionReactionsInDatabase(
  database: Pick<OmnipolymathAgentDatabase, "db">,
  sessionKey: string,
  params: { sessionId: string },
): Record<string, StoredMessageReactionSummary[]> {
  const messages = groupRecords(
    executeSqliteQuerySync(database.db, reactionRows(database, sessionKey, params.sessionId)).rows,
    (row) => row.message_id,
  );
  return Object.fromEntries(
    [...messages].map(([messageId, rows]) => [messageId, summarizeReactions(rows)]),
  );
}
