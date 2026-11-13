import { afterAll, expect, it, vi } from "vitest";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../config/runtime-snapshot.js";
import { listSessionEntriesCore } from "../config/sessions/session-accessor.entry.js";
import {
  loadSessionEntryReadOnly,
  upsertSessionEntryCore,
} from "../config/sessions/session-accessor.sqlite-entry.js";
import { observeMainThreadSql } from "../test-utils/main-thread-sql-spies.test-support.js";
import { useSessionStoreTempDirs } from "../test-utils/session-state-cleanup.js";
import { openOmnipolymathAgentDatabase } from "./omnipolymath-agent-db.js";
import {
  omnipolymathStateDatabaseCache,
  recordOmnipolymathStateDatabaseOpenFailure,
} from "./omnipolymath-state-db-cache.js";
import { withExistingOmnipolymathStateDatabaseReadOnly } from "./omnipolymath-state-db-readonly.js";
import { openOmnipolymathStateDatabase } from "./omnipolymath-state-db.js";

const sessionDirs = useSessionStoreTempDirs(afterAll, "omnipolymath-schema-budget-");
function observeExecutions() {
  const queries: string[] = [];
  return {
    ...observeMainThreadSql({
      onStatement: (sql) => {
        queries.push(sql);
      },
    }),
    queries,
  };
}
afterAll(() => {
  clearRuntimeConfigSnapshot();
  vi.restoreAllMocks();
});
function expectNoChecks(queries: string[]) {
  const schemaOrFreshness =
    /^PRAGMA (?:user_version|data_version)\b|\bsqlite_(?:master|schema)\b|FROM main\.pragma_data_version\(\)\s*$/iu;
  expect(queries.filter((sql) => schemaOrFreshness.test(sql))).toEqual([]);
}

it("keeps admitted reads free of schema checks and freshness probes", async () => {
  setRuntimeConfigSnapshot({});
  const trace = observeExecutions();
  const scope = {
    agentId: "main",
    env: { ...process.env, OMNIPOLYMATH_STATE_DIR: sessionDirs.make() },
    sessionKey: "agent:main:schema-budget",
    projection: "list" as const,
  };
  await upsertSessionEntryCore(scope, { sessionId: "schema-budget", updatedAt: 1 });
  openOmnipolymathAgentDatabase(scope);
  const state = openOmnipolymathStateDatabase(scope);
  const read = () => {
    expect(loadSessionEntryReadOnly(scope)?.sessionId).toBe("schema-budget");
    expect(listSessionEntriesCore(scope).map(({ entry }) => entry.sessionId)).toEqual([
      "schema-budget",
    ]);
    expect(openOmnipolymathStateDatabase(scope)).toBe(state);
  };
  read();
  expect(trace.queries.some((sql) => /^PRAGMA user_version\b/i.test(sql))).toBe(true);
  expect(
    trace.queries.some((sql) =>
      /^PRAGMA data_version\b|FROM main\.pragma_data_version\(\)\s*$/iu.test(sql),
    ),
  ).toBe(false);
  trace.queries.length = 0;

  // No await: all 100 reads of each entry point occur in the same event-loop turn.
  for (let i = 0; i < 100; i++) {
    read();
  }
  expectNoChecks(trace.queries);
  trace.queries.length = 0;
  for (let i = 0; i < 100; i++) {
    expect(withExistingOmnipolymathStateDatabaseReadOnly(({ db }) => db, scope)).toBe(state.db);
  }
  expectNoChecks(trace.queries);
  trace.restore();
});

it("invalidates cached admission after terminal revocation", () => {
  const scope = { env: { OMNIPOLYMATH_STATE_DIR: sessionDirs.make() } };
  const database = openOmnipolymathStateDatabase(scope);
  const cached = () => omnipolymathStateDatabaseCache.getCachedOmnipolymathStateDatabase(database.path);
  expect(cached()).toBe(database);
  const failure = new Error("synthetic revoked state admission");
  recordOmnipolymathStateDatabaseOpenFailure(database.path, failure);
  const trace = observeExecutions();
  expect(cached).toThrow(failure);
  expect(() => withExistingOmnipolymathStateDatabaseReadOnly(() => undefined, scope)).toThrow(failure);
  trace.expectIdle();
  trace.restore();
});
