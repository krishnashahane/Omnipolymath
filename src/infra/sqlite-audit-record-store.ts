import {
  openOmnipolymathStateDatabase,
  runOmnipolymathStateWriteTransaction,
  type OmnipolymathStateDatabaseOptions,
} from "../state/omnipolymath-state-db.js";
// Shared SQLite storage for bounded diagnostic audit records.
import type { EngineConnection } from "./sql-connection.js";
import {
  createSqliteAuditRecordKernel,
  prepareSqliteAuditRecord,
  type SqliteAuditRecordEntry,
} from "./sqlite-audit-record.kernel.js";

/** Opens one bounded audit-record scope in the shared state database. */
export function createSqliteAuditRecordStore<T>(
  options: OmnipolymathStateDatabaseOptions & { scope: string; maxEntries: number },
) {
  const scope = options.scope;
  const maxEntries = Math.max(1, Math.floor(options.maxEntries));
  const kernel = (database: EngineConnection) =>
    createSqliteAuditRecordKernel<T>(database, { scope, maxEntries });
  const prepare = (record: SqliteAuditRecordEntry<T>) => prepareSqliteAuditRecord(scope, record);
  return {
    upsert(key: string, value: T, createdAt = Date.now()): void {
      const record = prepare({ key, value, createdAt });
      runOmnipolymathStateWriteTransaction(({ db }) => kernel(db).upsert(record), options);
    },
    registerLegacyMany(records: readonly SqliteAuditRecordEntry<T>[]): void {
      const prepared = records.map(prepare);
      if (prepared.length === 0) {
        return;
      }
      runOmnipolymathStateWriteTransaction(
        ({ db }) => kernel(db).registerLegacyMany(prepared),
        options,
      );
    },
    entries() {
      return kernel(openOmnipolymathStateDatabase(options).db).entries();
    },
    latest(params: { limit: number; beforeSequence?: number }) {
      const limit = Math.max(0, Math.floor(params.limit));
      if (limit === 0) {
        return [];
      }
      return kernel(openOmnipolymathStateDatabase(options).db).latest({ ...params, limit });
    },
  };
}
