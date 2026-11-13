import {
  MEDIA_ROWS_MIGRATION_META_KEY,
  OMNIPOLYMATH_AGENT_SCHEMA_VERSION,
} from "../state/omnipolymath-agent-db-contract.js";
import { retainOmnipolymathAgentDatabaseReadOnly } from "../state/omnipolymath-agent-db-readonly.js";
import type { DB as OmnipolymathAgentKyselyDatabase } from "../state/omnipolymath-agent-db.generated.js";
import type { OmnipolymathStateLeaseContext } from "../state/omnipolymath-state-lease.js";
import { requireNativeDatabaseFile } from "./database-engine/physical-facts.js";
import { executeSqliteQueryTakeFirstSync, getNodeSqliteKysely } from "./kysely-sync.js";
import type { EngineConnection } from "./sql-connection.js";
import { resolveSqliteInspectionSignal } from "./sqlite-readonly-worker.js";
import { mediaRowsNeedMigration } from "./state-migrations.media-persistence-database.js";
import { transformMediaArchiveContent } from "./state-migrations.media-persistence-transform.js";
import { transcriptDirectiveArchivesNeedMigration } from "./state-migrations.transcript-directives-archives.js";

export function hasMediaRowsMigrationReceipt(database: EngineConnection): boolean {
  const db = getNodeSqliteKysely<Pick<OmnipolymathAgentKyselyDatabase, "schema_meta">>(database);
  return Boolean(
    executeSqliteQueryTakeFirstSync(
      database,
      db
        .selectFrom("schema_meta")
        .select("schema_version")
        .where("meta_key", "=", MEDIA_ROWS_MIGRATION_META_KEY),
    ),
  );
}

export async function inspectPostgresMediaPersistence(params: {
  agentId: string;
  env: NodeJS.ProcessEnv;
  pathname: string;
  migratedFromVersion?: number;
  maintenance: Pick<OmnipolymathStateLeaseContext, "signal">;
}) {
  const retained = retainOmnipolymathAgentDatabaseReadOnly({
    agentId: params.agentId,
    path: params.pathname,
    env: params.env,
  });
  if (!retained.found) {
    throw new Error(`Agent database is unavailable for media inspection: ${params.pathname}`);
  }
  try {
    const database = retained.database.db;
    const initialVersion = params.migratedFromVersion ?? OMNIPOLYMATH_AGENT_SCHEMA_VERSION;
    const deferred = initialVersion < OMNIPOLYMATH_AGENT_SCHEMA_VERSION;
    if (
      !deferred &&
      ((!hasMediaRowsMigrationReceipt(database) &&
        (await mediaRowsNeedMigration(database, params.pathname, {
          signal: resolveSqliteInspectionSignal(params.maintenance.signal),
        }))) ||
        (await transcriptDirectiveArchivesNeedMigration(
          database,
          { generation: "", sessionId: "" },
          transformMediaArchiveContent,
        )))
    ) {
      // Healthy PostgreSQL history needs no native schema or backup work.
      requireNativeDatabaseFile("postgres", "repair");
    }
    return {
      deferred,
      rewrittenSessions: 0,
      rewrittenTrajectoryRows: 0,
      rewrittenArchives: 0,
      warnings: [],
      initialVersion,
      finalVersion: OMNIPOLYMATH_AGENT_SCHEMA_VERSION,
    };
  } finally {
    retained.claim.release();
  }
}
