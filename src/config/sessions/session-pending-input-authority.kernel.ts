import {
  getSqliteReadScopeRevision,
  type SqliteReadScopeRevision,
} from "../../infra/sqlite-schema-facts.js";
import { runSqliteReadSnapshotSync } from "../../infra/sqlite-transaction.js";
import { toAgentStoreSessionKey } from "../../routing/session-key.js";
import { readOmnipolymathAgentDatabaseIdentity } from "../../state/omnipolymath-agent-db-identity.js";
import type { OmnipolymathAgentDatabase } from "../../state/omnipolymath-agent-db.js";
import { readSessionEntryRow } from "./session-accessor.sqlite-entry-read.js";
import { attachSessionEntrySnapshots } from "./session-entry-snapshot-values.js";
import type { SessionPendingInputAuthorityFacts } from "./session-pending-input-authority.js";
import { listSessionMembersInDatabase } from "./session-sharing-store.kernel.js";
import type { InternalSessionEntry as SessionEntry } from "./types.js";

export function readSessionPendingInputAuthorityFacts(
  database: Pick<OmnipolymathAgentDatabase, "db" | "path" | "agentId">,
  sessionKey: string,
  agentId = database.agentId,
  postimage?: { sessionKey: string; entry: SessionEntry; revision: SqliteReadScopeRevision },
): SessionPendingInputAuthorityFacts {
  return runSqliteReadSnapshotSync(database.db, () =>
    readSessionPendingInputAuthorityFactsInTransaction(
      database,
      sessionKey,
      agentId,
      postimage?.sessionKey === sessionKey &&
        getSqliteReadScopeRevision(database.db) === postimage.revision
        ? new Map([[sessionKey, structuredClone(postimage.entry)]])
        : undefined,
    ),
  );
}

/** The caller already owns the coherent SQLite transaction. */
export function readSessionPendingInputAuthorityFactsInTransaction(
  database: Pick<OmnipolymathAgentDatabase, "db" | "path" | "agentId">,
  sessionKey: string,
  agentId = database.agentId,
  /** Exact entries (including absence) read while this same transaction holds its lock. */
  entries?: ReadonlyMap<string, SessionEntry | undefined>,
): SessionPendingInputAuthorityFacts {
  const identity = readOmnipolymathAgentDatabaseIdentity(database);
  const entry = entries?.has(sessionKey)
    ? entries.get(sessionKey)
    : readSessionEntryRow(database, sessionKey, "list")?.entry;
  return {
    agentId,
    storePath: database.path,
    // Authority uses the logical agent key; SQLite keeps the original stored key.
    sessionKey: toAgentStoreSessionKey({ agentId, requestKey: sessionKey }),
    entry: entry ? attachSessionEntrySnapshots({ ...entry }, {}, "list") : undefined,
    readSource:
      typeof identity.identity === "string"
        ? {
            agentId: database.agentId,
            path: database.path,
            databaseIdentity: identity.identity,
            databaseBirthtime: identity.birthtime,
          }
        : undefined,
    members: listSessionMembersInDatabase(database, sessionKey),
  };
}
