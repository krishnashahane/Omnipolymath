import type { EngineConnection } from "../infra/sql-connection.js";
import { extractSqliteTableSchema } from "../infra/sqlite-schema-sql.js";
import type { OmnipolymathStateDatabaseOptions } from "./omnipolymath-state-db-contract.js";
import { runExistingOmnipolymathStateWriteTransaction } from "./omnipolymath-state-db-existing-write.js";
import type { OmnipolymathStateLeaseContext } from "./omnipolymath-state-lease-context.js";
import { getOmnipolymathDatabaseMaintenanceScope } from "./omnipolymath-state-maintenance-context.js";
import { OMNIPOLYMATH_STATE_SCHEMA_SQL } from "./omnipolymath-state-schema.js";

const existingAgentLeaseSchema = ["schema_meta", "state_leases", "agent_database_leases"]
  .map((table) =>
    extractSqliteTableSchema(OMNIPOLYMATH_STATE_SCHEMA_SQL, table, {
      endMarker: ") STRICT;",
      errorMessage: "Existing agent lease schema is unavailable.",
    }),
  )
  .join("\n");

export function withExistingAgentLeaseWrite<T>(
  maintenance: OmnipolymathStateLeaseContext,
  options: OmnipolymathStateDatabaseOptions,
  operation: (db: EngineConnection) => T,
): T {
  return runExistingOmnipolymathStateWriteTransaction(
    ({ db }) => {
      maintenance.assertOwnedInTransaction(db);
      const result = operation(db);
      maintenance.assertOwnedInTransaction(db);
      return result;
    },
    options,
    {
      operationLabel: "agent.database.maintenance.admission",
      schemaSql: existingAgentLeaseSchema,
      integrityCheck: getOmnipolymathDatabaseMaintenanceScope()?.sqliteIntegrityCheck,
      // Maintenance must drain published lease schemas before first-use provenance is added.
      schemaCompatibility: { allowedMissingColumns: ["agent_database_leases.provenance"] },
    },
  );
}
