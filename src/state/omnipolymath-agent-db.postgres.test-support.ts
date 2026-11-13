import type { SQLInputValue } from "node:sqlite";
import { expect } from "vitest";
import { withEngineStoreAdmission as admit } from "../infra/database-engine/admission-scope.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";

export function createDatabaseOpener(owners: Awaited<ReturnType<typeof loadOwners>>) {
  return (options: { agentId: string; path?: string }) => {
    const database = admit(() => owners.openOmnipolymathAgentDatabase(options));
    const statement = (sql: string) => database.db.prepare(sql);
    return {
      ...database,
      get: (sql: string, ...values: SQLInputValue[]) => admit(() => statement(sql).get(...values)),
      write: (sql: string, ...values: SQLInputValue[]) =>
        admit(() =>
          owners.runOmnipolymathAgentWriteTransaction(
            ({ db }) => db.prepare(sql).run(...values),
            options,
          ),
        ),
      [Symbol.dispose]: () => admit(() => owners.closeOmnipolymathAgentDatabaseByPath(database.path)),
    };
  };
}

export function expectAnchorOnly(databasePath: string) {
  using db = openNodeSqliteDatabase(databasePath, { readOnly: true });
  expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([
    { name: "omnipolymath_engine_anchor" },
  ]);
}

export async function loadOwners() {
  const [
    database,
    readonly,
    sessions,
    transcripts,
    hydration,
    outbox,
    drain,
    cleanup,
    search,
    engine,
    transcriptStore,
    transcriptFts,
  ] = await Promise.all([
    import("./omnipolymath-agent-db.js"),
    import("./omnipolymath-agent-db-readonly.js"),
    import("../config/sessions/session-accessor.sqlite-entry.js"),
    import("../config/sessions/session-accessor.sqlite-transcript-write.js"),
    import("../config/sessions/session-transcript-hydration.js"),
    import("../agents/harness/context-engine-turn-outbox-store.js"),
    import("../agents/harness/context-engine-turn-outbox.js"),
    import("../test-utils/session-state-cleanup.js"),
    import("../config/sessions/session-transcript-search.js"),
    import("./omnipolymath-agent-db-engine.js"),
    import("../config/sessions/session-accessor.sqlite-transcript-store.js"),
    import("../config/sessions/session-transcript-fts.js"),
  ]);
  return {
    openOmnipolymathAgentDatabase: database.openOmnipolymathAgentDatabase,
    getOmnipolymathAgentDatabaseIfOpen: database.getOmnipolymathAgentDatabaseIfOpen,
    closeOmnipolymathAgentDatabaseByPath: database.closeOmnipolymathAgentDatabaseByPath,
    closeOmnipolymathAgentDatabaseByPathAsync: database.closeOmnipolymathAgentDatabaseByPathAsync,
    runOmnipolymathAgentWriteTransaction: database.runOmnipolymathAgentWriteTransaction,
    openOmnipolymathAgentDatabaseReadOnly: readonly.openOmnipolymathAgentDatabaseReadOnly,
    upsertSessionEntryCore: sessions.upsertSessionEntryCore,
    appendTranscriptMessage: transcripts.appendTranscriptMessage,
    prepareSessionTranscriptHydration: hydration.prepareSessionTranscriptHydration,
    openContextEngineTurnOutboxWorkerStore: outbox.openContextEngineTurnOutboxWorkerStore,
    drainContextEngineTurnOutbox: drain.drainContextEngineTurnOutbox,
    cleanupSessionStateForTest: cleanup.cleanupSessionStateForTest,
    searchSessionTranscripts: search.searchSessionTranscripts,
    searchSessionTranscriptsReadOnlySync: search.searchSessionTranscriptsReadOnlySync,
    admitAgentEngineSearchExtensions: engine.admitAgentEngineSearchExtensions,
    openAgentEngineStore: engine.openAgentEngineStore,
    appendTranscriptEventsInTransaction: transcriptStore.appendTranscriptEventsInTransaction,
    createSessionTranscriptFtsInserter: transcriptFts.createSessionTranscriptFtsInserter,
    selectSessionTranscriptFtsRows: transcriptFts.selectSessionTranscriptFtsRows,
  };
}
