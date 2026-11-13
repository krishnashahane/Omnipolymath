import type { PluginCompatRecord } from "./types.js";

export const SQLITE_RUNTIME_COMPAT_RECORDS = [
  {
    code: "sqlite-runtime-native-access",
    status: "deprecated",
    owner: "sdk",
    deprecated: "2026-10-09",
    warningStarts: "2026-10-09",
    removeAfter: "2026-12-31",
    replacement:
      "Use openOmnipolymathAgentSqliteWorkerStoreV2 with required live authority and serializable domain commands. Worker backends use sqlite-worker-runtime primitives; explicit readOnly inspection and offline Doctor maintenance retain their native contracts. Native callbacks are not serialized or moved by adding await. Released calls retain their signatures and synchronous transaction ordering through the deprecation period and are removed in the first January 2027 stable release after the final compatibility day, 2026-12-31.",
    docsPath: "/plugins/sdk-migration/how-to-migrate#replace-native-sqlite-runtime-writes",
    surfaces: [
      "omnipolymath/plugin-sdk/sqlite-runtime.openNodeSqliteDatabase writable handles",
      "omnipolymath/plugin-sdk/sqlite-runtime.openOmnipolymathAgentSqliteWorkerStore publicationSource.DatabaseSync",
      "omnipolymath/plugin-sdk/sqlite-runtime.openOmnipolymathAgentDatabase",
      "omnipolymath/plugin-sdk/sqlite-runtime.borrowOmnipolymathAgentDatabase",
      "omnipolymath/plugin-sdk/sqlite-runtime.withOmnipolymathAgentDatabaseAsync",
      "omnipolymath/plugin-sdk/sqlite-runtime.withOmnipolymathAgentDatabaseWrite",
      "omnipolymath/plugin-sdk/sqlite-runtime.runOmnipolymathAgentWriteAdmission",
      "omnipolymath/plugin-sdk/sqlite-runtime.runSqliteImmediateTransaction",
      "omnipolymath/plugin-sdk/sqlite-runtime.runSqliteImmediateTransactionSync",
      "omnipolymath/plugin-sdk/sqlite-runtime.executeSqliteQuerySync",
      "omnipolymath/plugin-sdk/sqlite-runtime.executeSqliteQueryTakeFirstSync",
      "omnipolymath/plugin-sdk/sqlite-runtime.iterateSqliteQuerySync",
      "omnipolymath/plugin-sdk/sqlite-runtime.prepareSqliteQuerySync",
      "omnipolymath/plugin-sdk/sqlite-runtime.getNodeSqliteKysely",
    ],
    diagnostics: [
      "TypeScript @deprecated annotations and one shared warning per plugin identity and capability family on actual legacy use; unscoped consumers share a bounded SDK warning",
    ],
  },
] as const satisfies readonly PluginCompatRecord[];
