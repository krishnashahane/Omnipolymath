import { describe, expect, it, vi } from "vitest";
import { trackSqliteStatementExecutions } from "../../test/helpers/sqlite-statement-execution-counter.js";
import { isPostgresSqlConnection } from "../infra/sql-connection.js";
import {
  captureSqliteDatabaseAdmissions,
  readSqliteDatabaseIntegrityVerification,
  revokeSqliteDatabaseAdmissions,
  withSqliteDatabaseAdmissionExchange,
} from "../infra/sqlite-database-admission.js";
import { getSqlitePinnedReadSnapshot } from "../infra/sqlite-pinned-read-snapshot.js";
import { schemaAdmission } from "../infra/sqlite-schema-admission.js";
import { getAdmittedSqliteSchemaFacts } from "../infra/sqlite-schema-facts.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import { withReceiptFixture } from "./agent-validation.test-support.js";
import {
  openOmnipolymathAgentDatabaseReadOnly,
  hasOmnipolymathAgentReadOnlySchema,
} from "./omnipolymath-agent-db-readonly-open.js";
import { stageOmnipolymathAgentDatabaseSchemaExtension } from "./omnipolymath-agent-db-schema-extension.worker.js";
import { refreshOmnipolymathAgentDatabaseSchema } from "./omnipolymath-agent-db-schema-refresh.js";
import {
  adoptOmnipolymathAgentDatabaseSchema,
  captureOmnipolymathAgentDatabaseReadValidation,
  getOmnipolymathAgentDatabaseValidation,
  invalidateOmnipolymathAgentDatabaseValidation,
} from "./omnipolymath-agent-db-validation-cache.js";

describe("agent schema refresh", () => {
  it.each([false, true])(
    "settles repaired catalog publication after the pin (refuse=%s)",
    async (refuse) => {
      await withReceiptFixture(false, (database) => {
        if (isPostgresSqlConnection(database.db)) {
          throw new Error("Expected SQLite fixture");
        }
        const db = database.db;
        db.exec("DROP INDEX idx_agent_cache_expiry");
        invalidateOmnipolymathAgentDatabaseValidation(database.path);
        revokeSqliteDatabaseAdmissions(db);
        expect(readSqliteDatabaseIntegrityVerification(db)).toBeUndefined();
        const publicationFailure = new Error("Publication was not acknowledged");
        let repairedPublication = false;
        let publicationWasPinned: boolean | undefined;
        const exchange = vi.fn((admissions: ReturnType<typeof captureSqliteDatabaseAdmissions>) => {
          for (const record of admissions) {
            const facts = schemaAdmission.read?.(record.facts.get(schemaAdmission.name)?.value);
            if (facts?.indexes.has("idx_agent_cache_expiry")) {
              repairedPublication = true;
              publicationWasPinned = getSqlitePinnedReadSnapshot(db) !== undefined;
              if (refuse) {
                throw publicationFailure;
              }
            }
          }
          return [];
        });
        const refresh = () =>
          withSqliteDatabaseAdmissionExchange(exchange, () =>
            refreshOmnipolymathAgentDatabaseSchema(database, () => {}),
          );
        if (refuse) {
          expect(refresh).toThrow(publicationFailure);
          expect(getOmnipolymathAgentDatabaseValidation(database)).toBeUndefined();
        } else {
          expect(refresh()?.schema?.facts?.indexes.has("idx_agent_cache_expiry")).toBe(true);
        }
        expect(repairedPublication).toBe(true);
        expect(publicationWasPinned).toBe(false);
        expect(readSqliteDatabaseIntegrityVerification(db)).toBeUndefined();
      });
    },
  );

  it("publishes known derived DDL without repeating agent admission", async () => {
    await withReceiptFixture(false, (database, options) => {
      const reader = openOmnipolymathAgentDatabaseReadOnly(options);
      if (!reader.found || isPostgresSqlConnection(reader.database.db)) {
        throw new Error("Expected independent SQLite reader");
      }
      const previous = getOmnipolymathAgentDatabaseValidation(database)!;
      const retainedReader = captureOmnipolymathAgentDatabaseReadValidation(database);
      expect(retainedReader).toBeDefined();
      try {
        runSqliteImmediateTransactionSync(database.db, () => {
          stageOmnipolymathAgentDatabaseSchemaExtension(database.db);
          database.db.exec("CREATE TABLE derived_vectors(id TEXT PRIMARY KEY, vector BLOB)");
        });
        const observation = trackSqliteStatementExecutions(database.db, ["sql"], () => "sql");
        const readerObservation = trackSqliteStatementExecutions(
          reader.database.db,
          ["sql"],
          () => "sql",
        );
        try {
          const current = refreshOmnipolymathAgentDatabaseSchema(database, () => {});
          expect(() => retainedReader!.assertCurrent()).not.toThrow();
          expect(current.valid).toBe(previous.valid);
          expect(current.schema?.facts?.tables.has("derived_vectors")).toBe(true);
          expect(hasOmnipolymathAgentReadOnlySchema(reader.database)).toBe(true);
          expect(
            getAdmittedSqliteSchemaFacts(reader.database.db)?.tables.has("derived_vectors"),
          ).toBe(true);
          expect(observation.counts.sql).toBe(0);
          expect(readerObservation.counts.sql).toBe(0);
        } finally {
          readerObservation.restore();
          observation.restore();
        }
        // Unclassified DDL still invalidates the agent contract.
        database.db.exec("DROP TABLE derived_vectors");
        expect(adoptOmnipolymathAgentDatabaseSchema(database)).toBe(false);
        const refreshObservation = trackSqliteStatementExecutions(
          database.db,
          ["catalog"],
          (sql) =>
            sql === "SELECT type, name, tbl_name, sql FROM main.sqlite_schema ORDER BY name"
              ? "catalog"
              : null,
        );
        try {
          const refreshed = refreshOmnipolymathAgentDatabaseSchema(database, () => {});
          expect(refreshed.schema?.facts?.tables.has("derived_vectors")).toBe(false);
          expect(refreshObservation.counts.catalog).toBe(1);
        } finally {
          refreshObservation.restore();
        }
      } finally {
        reader.database.close();
      }
    });
  });
});
