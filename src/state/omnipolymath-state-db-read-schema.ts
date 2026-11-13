import { requireNativeDatabaseFile } from "../infra/database-engine/physical-facts.js";
import { isPostgresSqlConnection, type EngineConnection } from "../infra/sql-connection.js";
import type { SqliteSchemaErrorContext } from "../infra/sqlite-user-version.js";
import { getSqliteWorkerStateIntegrityAdmission } from "../infra/sqlite-worker-state-context.js";
import { assertExistingOmnipolymathStateRuntimeSchema } from "./omnipolymath-state-db-existing-schema.js";
import type { OmnipolymathStateIntegrityPolicy } from "./omnipolymath-state-db-integrity-admission.js";
import {
  assertSupportedStateSchemaVersion,
  type StateSchemaContentVersionRowReader,
} from "./omnipolymath-state-db-schema-version.js";

export function assertStateReadSchemaForPolicy(
  database: EngineConnection,
  pathname: string,
  existingSchema: boolean,
  integrityPolicy?: OmnipolymathStateIntegrityPolicy,
  readContentVersionRow?: StateSchemaContentVersionRowReader,
  context: SqliteSchemaErrorContext = "runtime",
): void {
  if (isPostgresSqlConnection(database)) {
    if (integrityPolicy !== undefined) {
      requireNativeDatabaseFile("postgres", "integrity");
    }
    assertSupportedStateSchemaVersion(
      database,
      pathname,
      undefined,
      readContentVersionRow,
      context,
    );
    return;
  }
  if (existingSchema) {
    assertExistingOmnipolymathStateRuntimeSchema(
      database,
      pathname,
      getSqliteWorkerStateIntegrityAdmission(),
      integrityPolicy,
      context,
    );
  } else {
    assertSupportedStateSchemaVersion(
      database,
      pathname,
      undefined,
      readContentVersionRow,
      context,
    );
  }
}
