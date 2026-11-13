import type { DatabaseSync } from "node:sqlite";
import { executeSqliteQueryTakeFirstSync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import { isPostgresSqlConnection } from "../infra/sql-connection.js";
import {
  createSqliteTableContractReader,
  readSqliteSchemaCookie,
} from "../infra/sqlite-schema-contract.js";
import { getAdmittedSqliteSchemaFacts } from "../infra/sqlite-schema-facts.js";
import { runSqliteReadSnapshotSync } from "../infra/sqlite-transaction.js";
import type { SqliteSchemaErrorContext } from "../infra/sqlite-user-version.js";
import {
  getStateRuntimeSchemaAdmission,
  getStateSchemaVersionAdmission,
  publishStateRuntimeSchemaAdmission,
} from "./omnipolymath-state-db-admission.js";
import type { OmnipolymathStateIntegrityAdmission } from "./omnipolymath-state-db-async-lifecycle.js";
import {
  OMNIPOLYMATH_STATE_SCHEMA_VERSION,
  type OmnipolymathStateDatabase,
} from "./omnipolymath-state-db-contract.js";
import {
  assertCurrentStateRuntimeSchema,
  assertNoLegacyStateRuntimeRepair,
} from "./omnipolymath-state-db-fast-path.js";
import { readTrackedStateDatabaseIdentity } from "./omnipolymath-state-db-handle.js";
import {
  assertOmnipolymathStateRuntimeIntegrity,
  type OmnipolymathStateIntegrityPolicy,
} from "./omnipolymath-state-db-integrity-admission.js";
import { classifySqliteTableReadError } from "./omnipolymath-state-db-schema-helpers.js";
import { isExistingOmnipolymathStateSchema } from "./omnipolymath-state-db-schema-policy.js";
import {
  assertSupportedStateSchemaVersion,
  readStateSchemaContentVersion,
} from "./omnipolymath-state-db-schema-version.js";
import type { DB } from "./omnipolymath-state-db.generated.js";

/** Metadata is validated with the physical database's first runtime admission. */
function assertExistingOmnipolymathStateRuntimeMetadata(
  database: DatabaseSync,
  pathname: string,
  context: SqliteSchemaErrorContext,
): number {
  if (getStateRuntimeSchemaAdmission(database)) {
    const version = getStateSchemaVersionAdmission(database)?.userVersion;
    if (version !== undefined) {
      return version;
    }
  }
  const version = assertSupportedStateSchemaVersion(
    database,
    pathname,
    undefined,
    undefined,
    context,
  );
  if (readStateSchemaContentVersion(database) !== OMNIPOLYMATH_STATE_SCHEMA_VERSION) {
    throw new Error(
      `Existing shared-state database ${pathname} requires schema migration by its owning installation; run omnipolymath doctor --fix there before using it.`,
    );
  }
  let metadata;
  try {
    metadata = executeSqliteQueryTakeFirstSync(
      database,
      getNodeSqliteKysely<Pick<DB, "schema_meta">>(database)
        .selectFrom("schema_meta")
        .select(["role", "schema_version"])
        .where("meta_key", "=", "primary")
        .limit(1),
    );
  } catch (error) {
    throw classifySqliteTableReadError(
      database,
      "schema_meta",
      ["meta_key", "role", "schema_version"],
      error,
    );
  }
  if (metadata?.role !== "global" || metadata.schema_version !== version) {
    throw new Error(
      `Existing shared-state database ${pathname} has inconsistent ownership or schema metadata.`,
    );
  }
  return version;
}

/** Validate an existing runtime schema without applying repairs. */
export function assertExistingOmnipolymathStateRuntimeSchema(
  database: DatabaseSync,
  pathname: string,
  integrity?: OmnipolymathStateIntegrityAdmission,
  integrityPolicy?: OmnipolymathStateIntegrityPolicy,
  context: SqliteSchemaErrorContext = "runtime",
): void {
  const admitted = getStateRuntimeSchemaAdmission(database)
    ? getAdmittedSqliteSchemaFacts(database)
    : undefined;
  if (admitted) {
    // Every warm handle must retain revocation custody for the integrity proof it borrows.
    assertOmnipolymathStateRuntimeIntegrity(
      database,
      pathname,
      admitted,
      integrity,
      integrityPolicy,
    )?.();
    return;
  }
  let publishIntegrity: (() => void) | undefined;
  runSqliteReadSnapshotSync(
    database,
    () => {
      const userVersion = assertExistingOmnipolymathStateRuntimeMetadata(database, pathname, context);
      const currentCookie = readSqliteSchemaCookie(database);
      if (typeof currentCookie !== "number") {
        throw new Error(
          `Existing shared-state database ${pathname} schema version is unavailable.`,
        );
      }
      publishIntegrity = assertOmnipolymathStateRuntimeIntegrity(
        database,
        pathname,
        { schemaVersion: currentCookie, userVersion },
        integrity,
        integrityPolicy,
      );
      const readTable = createSqliteTableContractReader(database);
      assertCurrentStateRuntimeSchema(database, pathname, readTable);
      assertNoLegacyStateRuntimeRepair(database, pathname);
    },
    { operationLabel: "state.admission.existing-schema" },
  );
  publishIntegrity?.();
  publishStateRuntimeSchemaAdmission(database, true);
}

export function assertStateDatabaseSchemaAdmission(database: OmnipolymathStateDatabase): void {
  if (isExistingOmnipolymathStateSchema(database.path, database.db)) {
    const location = readTrackedStateDatabaseIdentity(database.db)?.canonicalPath;
    if (!location) {
      throw new Error(
        "Existing shared-state schema admission requires a filesystem-backed database.",
      );
    }
    if (!isExistingOmnipolymathStateSchema(location, database.db)) {
      throw new Error(
        "Existing shared-state schema admission requires its selected physical database.",
      );
    }
    if (isPostgresSqlConnection(database.db)) {
      assertSupportedStateSchemaVersion(database.db, database.path);
      return;
    }
    assertExistingOmnipolymathStateRuntimeSchema(database.db, database.path);
  }
}
