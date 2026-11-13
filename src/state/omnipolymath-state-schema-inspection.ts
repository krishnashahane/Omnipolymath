import type { DatabaseSync } from "node:sqlite";
import {
  collectSqliteSchemaIssues,
  createSqliteTableContractReader,
  type SqliteSchemaIssue,
} from "../infra/sqlite-schema-contract.js";
import { SqliteSchemaMismatchError } from "../infra/sqlite-schema-issues.js";
import { assertOmnipolymathStateDatabaseOwner } from "./omnipolymath-state-db-maintenance.js";
import {
  isOmnipolymathStateFirstUseSchemaIssue,
  isOmnipolymathStateStartupRepairableSchemaIssue,
  OMNIPOLYMATH_STATE_MAINTENANCE_SCHEMA_COMPATIBILITY,
  STATE_RUNTIME_SCHEMA_COMPATIBILITY,
} from "./omnipolymath-state-schema-compatibility.js";
import { OMNIPOLYMATH_STATE_SCHEMA_SQL } from "./omnipolymath-state-schema.js";

function deduplicateSchemaIssues(issues: readonly SqliteSchemaIssue[]): SqliteSchemaIssue[] {
  return [
    ...new Map(
      issues.map((issue) => [`${issue.code}\0${issue.objectName}`, issue] as const),
    ).values(),
  ];
}

export function inspectCurrentStateStartupSchema(
  database: DatabaseSync,
  databasePath: string,
  foundVersion: number,
) {
  const metadata = assertOmnipolymathStateDatabaseOwner(database, { pathname: databasePath });
  if (metadata?.schema_version !== foundVersion) {
    throw new SqliteSchemaMismatchError(
      `Omnipolymath state database ${databasePath} metadata schema version ${typeof metadata?.schema_version === "number" ? metadata.schema_version : "invalid"} does not match ${foundVersion}.`,
    );
  }
  // Both policies inspect the same private or immutable snapshot; later opens read fresh facts.
  const readTable = createSqliteTableContractReader(database);
  const issues = deduplicateSchemaIssues([
    ...collectSqliteSchemaIssues(
      database,
      OMNIPOLYMATH_STATE_SCHEMA_SQL,
      OMNIPOLYMATH_STATE_MAINTENANCE_SCHEMA_COMPATIBILITY,
      readTable,
    ),
    ...collectSqliteSchemaIssues(
      database,
      OMNIPOLYMATH_STATE_SCHEMA_SQL,
      STATE_RUNTIME_SCHEMA_COMPATIBILITY,
      readTable,
    ),
  ]);
  return {
    blockingIssues: issues.filter(
      (issue) =>
        !isOmnipolymathStateStartupRepairableSchemaIssue(issue) &&
        !isOmnipolymathStateFirstUseSchemaIssue(issue),
    ),
    startupRepairableIssues: issues.filter(isOmnipolymathStateStartupRepairableSchemaIssue),
  };
}
