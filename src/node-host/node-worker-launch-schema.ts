import { isPostgresSqlConnection, type EngineConnection } from "../infra/sql-connection.js";
import { createSqliteSchemaEnsurer } from "../infra/sqlite-schema-ensure.js";
import { ensureStatePostgresFragment } from "../state/omnipolymath-state-db-engine.js";
import { getOmnipolymathStateFeatureSchemaSql } from "../state/omnipolymath-state-feature-schema.js";

const NODE_WORKER_LAUNCH_SCHEMA_END = "\n  WHERE completed_at_ms IS NOT NULL;";

const launchSchemaTables = [
  "node_worker_launches",
  "node_worker_launch_boots",
  "node_worker_launch_containers",
  "node_worker_launch_cleanup",
  "node_worker_launch_process_scopes",
] as const;

const launchSchemaEnsurers = new Map(
  launchSchemaTables.map((table) => [
    table,
    createSqliteSchemaEnsurer(
      () =>
        getOmnipolymathStateFeatureSchemaSql(table, {
          endMarker: table === "node_worker_launches" ? NODE_WORKER_LAUNCH_SCHEMA_END : undefined,
        }),
      {
        tables: [table],
        indexes:
          table === "node_worker_launches" ? ["idx_node_worker_launches_terminal_completed"] : [],
      },
    ),
  ]),
);

export const ensureNodeWorkerLaunchSchema = (
  database: EngineConnection,
  table: (typeof launchSchemaTables)[number],
): void => {
  if (isPostgresSqlConnection(database)) {
    ensureStatePostgresFragment(database, table);
  } else {
    launchSchemaEnsurers.get(table)!(database);
  }
};
