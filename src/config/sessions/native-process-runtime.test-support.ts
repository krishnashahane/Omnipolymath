export const sessionNativeProcessEntrypoints = {
  walScheduler: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "../../infra/sqlite-wal-scheduler.test-support",
    distWorkerPath: "infra/sqlite-wal-scheduler.test-support.js",
  },
  accessor: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "session-accessor",
    distWorkerPath: "config/sessions/session-accessor.js",
  },
  compactionCrash: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "session-compaction-crash.test-support",
    distWorkerPath: "config/sessions/session-compaction-crash.test-support.js",
  },
  canonicalReadiness: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "session-canonical-validation-readiness",
    distWorkerPath: "config/sessions/session-canonical-validation-readiness.js",
  },
  databaseReadOnly: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "../../state/omnipolymath-agent-db-readonly-open",
    distWorkerPath: "state/omnipolymath-agent-db-readonly-open.js",
  },
  databaseValidation: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "../../state/omnipolymath-agent-db-validation-cache",
    distWorkerPath: "state/omnipolymath-agent-db-validation-cache.js",
  },
  databaseRegistry: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "../../state/omnipolymath-agent-db-registry",
    distWorkerPath: "state/omnipolymath-agent-db-registry.js",
  },
} as const;
