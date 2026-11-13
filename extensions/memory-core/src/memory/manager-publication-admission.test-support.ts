import assert from "node:assert/strict";
import { ensureMemoryIndexSchema } from "omnipolymath/plugin-sdk/memory-core-host-engine-schema";
import { isPostgresSqlConnection } from "omnipolymath/plugin-sdk/memory-core-host-engine-storage";
import { openOmnipolymathAgentDatabase } from "omnipolymath/plugin-sdk/sqlite-runtime";
import {
  closeOmnipolymathAgentDatabasesAsync,
  createOmnipolymathDatabaseMaintenanceScope,
} from "omnipolymath/plugin-sdk/sqlite-runtime-testing";
import { getSqliteDatabaseAdmission } from "omnipolymath/plugin-sdk/sqlite-worker-runtime";

const [databasePath, mode] = process.argv.slice(2);
assert.ok(databasePath && (mode === "runtime" || mode === "full"));
const maintenance =
  mode === "full"
    ? createOmnipolymathDatabaseMaintenanceScope({ sqliteIntegrityCheck: "full" })
    : undefined;
try {
  const open = () => openOmnipolymathAgentDatabase({ agentId: "main", path: databasePath });
  const reopened = maintenance ? maintenance.run(open) : open();
  assert.ok(!isPostgresSqlConnection(reopened.db));
  const verification = getSqliteDatabaseAdmission(reopened.db, {
    name: "sqlite.full-verification",
    read: (value) => (typeof value === "number" ? value : undefined),
  });
  let schemaRebuilt = false;
  for (const method of ["exec", "prepare"] as const) {
    Object.defineProperty(reopened.db, method, {
      value: new Proxy(reopened.db[method], {
        apply(target, receiver, args) {
          schemaRebuilt ||= /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TRIGGER|VIRTUAL)\b/iu.test(
            args[0],
          );
          return Reflect.apply(target, receiver, args);
        },
      }),
    });
  }
  const { ftsAvailable } = ensureMemoryIndexSchema({
    db: reopened.db,
    cacheEnabled: true,
    ftsEnabled: true,
  });
  console.log(JSON.stringify({ verification: verification ?? null, schemaRebuilt, ftsAvailable }));
} finally {
  await (maintenance ? maintenance.close() : closeOmnipolymathAgentDatabasesAsync());
}
