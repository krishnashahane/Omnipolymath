import { isPostgresSqlConnection } from "../infra/sql-connection.js";
import type { EngineConnection } from "../infra/sql-connection.js";
import { createSqliteSchemaEnsurer } from "../infra/sqlite-schema-ensure.js";
import { ensureStatePostgresFragment } from "./omnipolymath-state-db-engine.js";
import {
  openOmnipolymathStateDatabase,
  runOmnipolymathStateWriteTransaction,
  type OmnipolymathStateDatabaseOptions,
} from "./omnipolymath-state-db.js";
import { getOmnipolymathStateFeatureSchemaSql } from "./omnipolymath-state-feature-schema.js";
import { withPostgresSchemaAdmissionRetry } from "./omnipolymath-state-postgres-admission.js";

/** Prepare canonical DDL without opening a database; admission owns schema presence. */
export function createOmnipolymathStateSchemaEnsurer(params: {
  table: string;
  additionalTables?: readonly string[];
  indexes?: readonly string[];
  endMarker?: string;
  operationLabel: string;
}): (options?: OmnipolymathStateDatabaseOptions) => void {
  const schema = getOmnipolymathStateFeatureSchemaSql(params.table, {
    endMarker: params.endMarker ?? "\n) STRICT;\n",
    errorMessage: `Canonical state schema markers are missing for ${params.table}`,
  });
  const ensure = createSqliteSchemaEnsurer(() => schema, {
    tables: [params.table, ...(params.additionalTables ?? [])],
    indexes: params.indexes,
  });
  return (options = {}) => {
    const { db } = openOmnipolymathStateDatabase(options);
    const runWrite = (install: (database: EngineConnection) => void) =>
      runOmnipolymathStateWriteTransaction(
        ({ db: txDb }) => {
          if (isPostgresSqlConnection(txDb)) {
            ensureStatePostgresFragment(txDb, params.table);
          } else {
            install(txDb);
          }
        },
        options,
        { operationLabel: params.operationLabel },
      );
    if (isPostgresSqlConnection(db)) {
      // This transaction owns only schema installation, so rollback makes replay safe.
      withPostgresSchemaAdmissionRetry(db, () => runWrite(ensure));
    } else {
      ensure(db, runWrite);
    }
  };
}
