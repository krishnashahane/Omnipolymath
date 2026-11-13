import { existsSync } from "node:fs";
import { isPostgresSqlConnection } from "../infra/sql-connection.js";
import { openSqliteReadOnlyDatabase } from "../infra/sqlite-snapshot-source.js";
import { hasUpdateDoctorMigrationCapture } from "../infra/update-doctor-migration-attribution.js";
import type {
  OmnipolymathStateDatabaseOptions,
  OmnipolymathStateDatabaseSchemaMigration,
} from "./omnipolymath-state-db-contract.js";
import { isStatePostgres } from "./omnipolymath-state-db-engine.js";
import {
  withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnly,
  withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnlyAsync,
} from "./omnipolymath-state-db-readonly.js";
import { detectOmnipolymathStateDatabaseSchemaMigrationsFromDatabase } from "./omnipolymath-state-db-schema-repair.js";
import { resolveDatabasePath } from "./omnipolymath-state-db.paths.js";

/** Doctor prepares its private source before entering synchronous schema inspection. */
export async function detectOmnipolymathStateDatabaseSchemaMigrationsAsync(
  options: OmnipolymathStateDatabaseOptions = {},
): Promise<OmnipolymathStateDatabaseSchemaMigration[]> {
  const pathname = resolveDatabasePath(options);
  return (
    (await withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnlyAsync(
      ({ db }) =>
        isPostgresSqlConnection(db)
          ? []
          : detectOmnipolymathStateDatabaseSchemaMigrationsFromDatabase(db, pathname),
      { ...options, path: pathname },
    )) ?? []
  );
}

export function detectOmnipolymathStateDatabaseSchemaMigrations(
  options: OmnipolymathStateDatabaseOptions = {},
  behavior: { artifactPreservingReadOnly?: boolean } = {},
): OmnipolymathStateDatabaseSchemaMigration[] {
  const pathname = resolveDatabasePath(options);
  if (!existsSync(pathname)) {
    return [];
  }
  if (
    isStatePostgres() ||
    behavior.artifactPreservingReadOnly ||
    hasUpdateDoctorMigrationCapture()
  ) {
    return (
      withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnly(
        ({ db }) => {
          if (isPostgresSqlConnection(db)) {
            // PostgreSQL's engine owner admits its migrations; these inspect legacy SQLite layouts.
            return [];
          }
          return detectOmnipolymathStateDatabaseSchemaMigrationsFromDatabase(db, pathname);
        },
        { ...options, path: pathname },
      ) ?? []
    );
  }
  const db = openSqliteReadOnlyDatabase(pathname, { readOnly: true });
  try {
    return detectOmnipolymathStateDatabaseSchemaMigrationsFromDatabase(db, pathname);
  } finally {
    db.close();
  }
}
