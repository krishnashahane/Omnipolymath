import { extractSqliteTableSchema } from "../infra/sqlite-schema-sql.js";
import {
  DOCTOR_OWNED_STATE_TABLES,
  FIRST_USE_STATE_INDEXES,
  FIRST_USE_STATE_TABLES,
  LAZY_ADDITIVE_STATE_INDEXES,
  LAZY_ADDITIVE_STATE_TABLES,
} from "./omnipolymath-state-db-contract.js";
import { withLegacyStateHeadLayout } from "./omnipolymath-state-db-schema-v26-layout.js";
import { withLegacyStateWriteIndexes } from "./omnipolymath-state-db-schema-v27-indexes.js";
import { withLegacyLocalWorkspaceManifests } from "./omnipolymath-state-db-schema-v31-workspace-manifests.js";
import { withLegacyLocalWorkspaceCas } from "./omnipolymath-state-db-schema-v35-workspace-cas.js";
import { withLegacyTemplateStateSchema } from "./omnipolymath-state-db-schema-v36-template-names.js";
import { withLegacyWorkerResourceReceipts } from "./omnipolymath-state-db-schema-v37-resource-receipts.js";
import { withLegacyRepositoryDiskAuthority } from "./omnipolymath-state-db-schema-v38-repository-disk.js";
import { withLegacyWorkerRetention } from "./omnipolymath-state-db-schema-v39-worker-retention.js";
import { withLegacyStateV40Additions } from "./omnipolymath-state-db-schema-v40-lazy-additions.js";
import { OMNIPOLYMATH_STATE_SCHEMA_SQL } from "./omnipolymath-state-schema.js";

const runtimeSchemaCache = new Map<string, string>();

/** Project canonical SQL to the tables the shared runtime may create during this open. */
export function getOmnipolymathStateRuntimeSchema(
  options: {
    includeVersionLazyAdditiveTables: boolean;
    includeAgentDeletionJournal?: boolean;
  },
  schemaSql = OMNIPOLYMATH_STATE_SCHEMA_SQL,
): string {
  const { includeVersionLazyAdditiveTables, includeAgentDeletionJournal = true } = options;
  // Catalog generation interleaves historical sources with current runtime requests.
  const sourceKey = schemaSql === OMNIPOLYMATH_STATE_SCHEMA_SQL ? "current" : schemaSql;
  const key = `${includeVersionLazyAdditiveTables}:${includeAgentDeletionJournal}:${sourceKey}`;
  const cached = runtimeSchemaCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  let schema = schemaSql;
  const omittedTables = [
    ...(includeVersionLazyAdditiveTables ? FIRST_USE_STATE_TABLES : LAZY_ADDITIVE_STATE_TABLES),
    ...(includeAgentDeletionJournal ? [] : DOCTOR_OWNED_STATE_TABLES),
  ];
  const omittedIndexes = includeVersionLazyAdditiveTables
    ? FIRST_USE_STATE_INDEXES
    : LAZY_ADDITIVE_STATE_INDEXES;
  for (const tableName of omittedTables) {
    // Historical source layouts can predate today's optional tables.
    if (
      schemaSql !== OMNIPOLYMATH_STATE_SCHEMA_SQL &&
      !schema.includes(`CREATE TABLE IF NOT EXISTS ${tableName} (`)
    ) {
      continue;
    }
    schema = schema.replace(
      extractSqliteTableSchema(schema, tableName, {
        errorMessage: `lazy additive state schema block is missing for ${tableName}`,
      }),
      "",
    );
  }
  for (const indexName of omittedIndexes) {
    const plainStart = schema.indexOf(`CREATE INDEX IF NOT EXISTS ${indexName}`);
    const uniqueStart = schema.indexOf(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName}`);
    const start = plainStart >= 0 ? plainStart : uniqueStart;
    const end = start >= 0 ? schema.indexOf(";", start) : -1;
    if (start < 0 || end < 0) {
      throw new Error(`lazy additive state schema index is missing for ${indexName}`);
    }
    schema = `${schema.slice(0, start)}${schema.slice(end + 1)}`;
  }
  runtimeSchemaCache.set(key, schema);
  return schema;
}

/** Keep runtime predecessor admission and generated catalog inputs on the same transform chain. */
export function getOmnipolymathStatePredecessorSchema(version: number): string {
  let schema = OMNIPOLYMATH_STATE_SCHEMA_SQL;
  for (const [introduced, transform] of [
    [40, withLegacyStateV40Additions],
    [39, withLegacyWorkerRetention],
    [38, withLegacyRepositoryDiskAuthority],
    [37, withLegacyWorkerResourceReceipts],
    [36, withLegacyTemplateStateSchema],
    [35, withLegacyLocalWorkspaceCas],
    [31, withLegacyLocalWorkspaceManifests],
    [27, withLegacyStateWriteIndexes],
    [26, withLegacyStateHeadLayout],
  ] as const) {
    if (version < introduced) {
      schema = transform(schema);
    }
  }
  return schema;
}
