import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { isMainThread } from "node:worker_threads";
import { openNodeSqliteDatabase, resolveExistingSqliteFileUri } from "../infra/node-sqlite.js";
import type { EngineConnection } from "../infra/sql-connection.js";
import { setSqliteBusyTimeout } from "../infra/sqlite-busy-timeout.js";
import { getOrLoadSqliteDatabaseAdmissionForPath } from "../infra/sqlite-database-admission.js";
import {
  invalidateSqliteSchemaFacts,
  runSqliteReadOperationSync,
} from "../infra/sqlite-schema-facts.js";
import { openSqliteReadOnlyDatabase } from "../infra/sqlite-snapshot-source.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { agentDatabaseBorrowers as cache } from "./omnipolymath-agent-db-borrower.js";
import type { OmnipolymathAgentDatabaseOwnerInspection } from "./omnipolymath-agent-db-contract.js";
import { agentEngineInput, openAgentEngineStore } from "./omnipolymath-agent-db-engine.js";
import { agentSchemaMetadataKey } from "./omnipolymath-agent-db-metadata.js";
import {
  assertSupportedAgentSchemaVersion,
  readExistingAgentSchemaMeta,
} from "./omnipolymath-agent-db-schema-read.js";
import { OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS } from "./omnipolymath-state-db-contract.js";

/** Read a database's durable role and agent owner without mutating it. */
export function inspectOmnipolymathAgentDatabaseOwner(
  pathname: string,
  options?: { revalidateSchema: true },
): OmnipolymathAgentDatabaseOwnerInspection {
  if (isMainThread && agentEngineInput()) {
    const metadata = getOrLoadSqliteDatabaseAdmissionForPath(
      pathname,
      agentSchemaMetadataKey,
      () => undefined,
    );
    if (!options?.revalidateSchema && metadata?.role === "agent" && metadata.agentId) {
      return { status: "owned", agentId: normalizeAgentId(metadata.agentId) };
    }
    throw new Error(
      "PostgreSQL agent ownership requires worker preparation before synchronous inspection; use the asynchronous agent database preparation owner.",
    );
  }
  let db: DatabaseSync | undefined;
  let engine: EngineConnection | undefined;
  try {
    // Failed opens retain a disposal-only handle whose agentId is the request,
    // not a verified owner. Only admitted handles can answer from cache.
    const resolvedPath = path.resolve(pathname);
    const opened = cache.databases.get(resolvedPath);
    if (!options?.revalidateSchema && opened?.db.isOpen && !cache.failures.has(resolvedPath)) {
      runSqliteReadOperationSync(opened.db, () =>
        assertSupportedAgentSchemaVersion(opened.db, pathname),
      );
      cache.idleTimers.get(opened.db)?.refresh();
      return { status: "owned", agentId: opened.agentId };
    }
    db = agentEngineInput()
      ? openNodeSqliteDatabase(resolveExistingSqliteFileUri(pathname), {
          timeout: OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS,
        })
      : openSqliteReadOnlyDatabase(pathname, { readOnly: true });
    setSqliteBusyTimeout(db, OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS);
    if (agentEngineInput()) {
      engine = openAgentEngineStore(db, undefined, pathname, true);
    } else if (options?.revalidateSchema) {
      invalidateSqliteSchemaFacts(db);
    }
    assertSupportedAgentSchemaVersion(engine ?? db, pathname);
    const existing = readExistingAgentSchemaMeta(engine ?? db);
    if (!existing) {
      return { status: "unowned" };
    }
    if (existing.role !== "agent" || !existing.agentId) {
      return { status: "unreadable" };
    }
    return { status: "owned", agentId: normalizeAgentId(existing.agentId) };
  } catch {
    return { status: "unreadable" };
  } finally {
    try {
      engine?.close();
    } finally {
      db?.close();
    }
  }
}
