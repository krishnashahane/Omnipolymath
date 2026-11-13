import { statSync } from "node:fs";
import path from "node:path";
import { resolveIdentityPathViaExistingAncestorSync } from "../infra/boundary-path.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import type { EngineConnection } from "../infra/sql-connection.js";
import { stageSqliteTransactionState } from "../infra/sqlite-post-commit.js";
import {
  assertAgentDeletionPathFence,
  prepareAgentDeletionPathFence,
} from "./agent-deletion-journal.js";
import {
  OMNIPOLYMATH_AGENT_SCHEMA_VERSION,
  type OmnipolymathAgentDatabaseRegistrationObserver,
} from "./omnipolymath-agent-db-contract.js";
import {
  emitOmnipolymathAgentDatabaseRegistryChange,
  recordOmnipolymathAgentDatabaseRegistryMutation,
} from "./omnipolymath-agent-db-registry-listing.js";
import {
  adoptOmnipolymathAgentDatabaseSchema,
  invalidateOmnipolymathAgentDatabaseValidation,
  invalidateOmnipolymathAgentDatabaseValidationsForAgent,
  setOmnipolymathAgentDatabaseValidation,
} from "./omnipolymath-agent-db-validation-cache.js";
import {
  isPersistentOmnipolymathAgentDatabasePath,
  isSameOmnipolymathAgentDatabasePath,
} from "./omnipolymath-agent-db.paths.js";
import { requireOmnipolymathStateDatabaseIdentity } from "./omnipolymath-state-db-cache.js";
import type { OmnipolymathStateDatabase } from "./omnipolymath-state-db-contract.js";
import type { DB as OmnipolymathStateKyselyDatabase } from "./omnipolymath-state-db.generated.js";
import { runOmnipolymathStateWriteTransaction } from "./omnipolymath-state-db.js";
import {
  resolveOmnipolymathAgentDatabaseStoredPath,
  resolveOmnipolymathRegisteredAgentDatabasePath,
} from "./omnipolymath-state-db.paths.js";

export {
  inspectOmnipolymathRegisteredAgentDatabases,
  listOmnipolymathRegisteredAgentDatabases,
  readOmnipolymathAgentDatabaseRegistryToken,
} from "./omnipolymath-agent-db-registry-listing.js";

type OmnipolymathAgentRegistryDatabase = Pick<OmnipolymathStateKyselyDatabase, "agent_databases">;

function resolveRegisteredAgentDatabaseStoredPath(
  database: OmnipolymathStateDatabase,
  params: { agentId: string; path: string },
): string {
  const storedPath = resolveOmnipolymathAgentDatabaseStoredPath(database.path, params.path);
  if (params.path !== resolveIdentityPathViaExistingAncestorSync(params.path)) {
    return storedPath;
  }
  const db = getNodeSqliteKysely<OmnipolymathAgentRegistryDatabase>(database.db);
  const { rows } = executeSqliteQuerySync(
    database.db,
    db.selectFrom("agent_databases").select("path").where("agent_id", "=", params.agentId),
  );
  // A canonical native open must update the existing configured locator, including external aliases.
  return rows.some((row) => row.path === storedPath)
    ? storedPath
    : (rows.find((row) =>
        isSameOmnipolymathAgentDatabasePath(
          resolveOmnipolymathRegisteredAgentDatabasePath(database.path, row.path),
          params.path,
        ),
      )?.path ?? storedPath);
}

export function registerOmnipolymathAgentDatabase(
  params: {
    agentId: string;
    path: string;
    env?: NodeJS.ProcessEnv;
    schemaVersion?: number;
    /** Supplied only by the opener after integrity and canonical schema admission. */
    admittedDb?: EngineConnection;
  },
  observer?: OmnipolymathAgentDatabaseRegistrationObserver,
): void {
  if (!isPersistentOmnipolymathAgentDatabasePath(params.path, params.env)) {
    if (params.admittedDb) {
      setOmnipolymathAgentDatabaseValidation({ ...params, db: params.admittedDb });
    }
    return;
  }
  const deletionFence = prepareAgentDeletionPathFence(
    { agentId: params.agentId, path: params.path },
    { env: params.env },
  );
  let sizeBytes: number | null = null;
  try {
    sizeBytes = statSync(params.path).size;
  } catch {
    sizeBytes = null;
  }
  const lastSeenAt = Date.now();
  observer?.starting?.();
  runOmnipolymathStateWriteTransaction(
    (database) => {
      assertAgentDeletionPathFence(database, deletionFence);
      const storedPath = resolveRegisteredAgentDatabaseStoredPath(database, params);
      const db = getNodeSqliteKysely<OmnipolymathAgentRegistryDatabase>(database.db);
      executeSqliteQuerySync(
        database.db,
        db
          .insertInto("agent_databases")
          .values({
            agent_id: params.agentId,
            path: storedPath,
            schema_version: params.schemaVersion ?? OMNIPOLYMATH_AGENT_SCHEMA_VERSION,
            last_seen_at: lastSeenAt,
            size_bytes: sizeBytes,
          })
          .onConflict((conflict) =>
            conflict.columns(["agent_id", "path"]).doUpdateSet({
              schema_version: params.schemaVersion ?? OMNIPOLYMATH_AGENT_SCHEMA_VERSION,
              last_seen_at: lastSeenAt,
              size_bytes: sizeBytes,
            }),
          ),
      );
      recordOmnipolymathAgentDatabaseRegistryMutation(database, "upsert", [params]);
      const onCommitted = observer?.committed;
      if (onCommitted) {
        const receipt = Object.freeze({
          agentId: params.agentId,
          agentPath: params.path,
          stateDatabasePath: database.path,
          stateDatabaseIdentity: requireOmnipolymathStateDatabaseIdentity(database).key,
        });
        // Record the native fact before fallible observers; the recorder never performs work.
        if (
          !stageSqliteTransactionState(database.db, {
            stage() {},
            rollback() {},
            commit: () => onCommitted(receipt),
          })
        ) {
          throw new Error(
            "Agent registration requires its canonical transaction publication scope",
          );
        }
      }
      emitOmnipolymathAgentDatabaseRegistryChange(params.agentId, database.db);
    },
    { env: params.env, initializationAgentPaths: [params.path] },
  );
  if (params.admittedDb) {
    const database = { ...params, db: params.admittedDb };
    if (!adoptOmnipolymathAgentDatabaseSchema(database)) {
      setOmnipolymathAgentDatabaseValidation(database);
    }
  } else {
    invalidateOmnipolymathAgentDatabaseValidation(params.path);
  }
}

export function unregisterOmnipolymathAgentDatabase(params: {
  agentId: string;
  path: string;
  env?: NodeJS.ProcessEnv;
}): void {
  runOmnipolymathStateWriteTransaction(
    (database) => {
      const storedPath = resolveRegisteredAgentDatabaseStoredPath(database, params);
      const matchingPaths = [...new Set([storedPath, params.path, path.resolve(params.path)])];
      const db = getNodeSqliteKysely<OmnipolymathAgentRegistryDatabase>(database.db);
      executeSqliteQuerySync(
        database.db,
        db
          .deleteFrom("agent_databases")
          .where("agent_id", "=", params.agentId)
          .where("path", "in", matchingPaths),
      );
      recordOmnipolymathAgentDatabaseRegistryMutation(database, "remove", [params]);
      emitOmnipolymathAgentDatabaseRegistryChange(params.agentId, database.db);
    },
    { env: params.env, initializationAgentPaths: [params.path] },
  );
  invalidateOmnipolymathAgentDatabaseValidation(params.path);
}

/** Remove every durable database registration owned by a deleted agent. */
export function unregisterOmnipolymathAgentDatabases(params: {
  agentId: string;
  env?: NodeJS.ProcessEnv;
  database?: OmnipolymathStateDatabase;
}): void {
  const options = {
    env: params.env,
    ...(params.database ? { database: params.database, path: params.database.path } : {}),
  };
  const removedPaths = runOmnipolymathStateWriteTransaction((database) => {
    const db = getNodeSqliteKysely<OmnipolymathAgentRegistryDatabase>(database.db);
    const removed = executeSqliteQuerySync(
      database.db,
      db.deleteFrom("agent_databases").where("agent_id", "=", params.agentId).returning("path"),
    );
    recordOmnipolymathAgentDatabaseRegistryMutation(
      database,
      "remove",
      removed.rows.map((row) => ({
        agentId: params.agentId,
        path: resolveOmnipolymathRegisteredAgentDatabasePath(database.path, row.path),
      })),
    );
    emitOmnipolymathAgentDatabaseRegistryChange(params.agentId, database.db);
    return removed.rows.map((row) =>
      resolveOmnipolymathRegisteredAgentDatabasePath(database.path, row.path),
    );
  }, options);
  invalidateOmnipolymathAgentDatabaseValidationsForAgent(params.agentId, removedPaths);
}
