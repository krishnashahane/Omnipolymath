import { isMainThread } from "node:worker_threads";
import {
  assertExistingDatabaseIdentity,
  readDatabasePathIdentitySync,
} from "../../infra/sqlite-worker-identity.js";
import { assertAgentSessionWriteAdmission } from "../../sessions/session-agent-work-admission.js";
import {
  getOmnipolymathAgentDatabaseIfOpen,
  resolveOmnipolymathAgentSqlitePath,
  type OmnipolymathAgentDatabase,
} from "../../state/omnipolymath-agent-db.js";
import type { OmnipolymathAgentDatabaseExecution } from "../../state/omnipolymath-agent-execution-contract.js";
import { supportsOmnipolymathAgentDatabaseExecution } from "../../state/omnipolymath-agent-execution.js";
import { cloneEnvWithPlatformSemantics } from "../config-env-vars.js";
import { resolveStateDir } from "../paths.js";
import type { SqliteLifecycleTargetSnapshot } from "./session-accessor.sqlite-entry-equality.js";
import { toDatabaseOptions, type ResolvedSqliteScope } from "./session-accessor.sqlite-scope.js";
import type {
  SessionEntryPatchContext,
  SessionEntryPatchOptions,
} from "./session-accessor.types.js";
import type { SessionEntryPatchOperation } from "./session-entry-patch-operation.js";
import type {
  SessionEntryPatchCommitObserver,
  SessionEntryPatchGuard,
  SessionEntryPatchSelection,
} from "./session-entry-patch.types.js";
import { assertCapturedSessionEntryReadSource } from "./session-entry-read-source.js";
import type { CapturedSessionEntryReadSource } from "./session-entry-read-source.types.js";
import type { InternalSessionEntry as SessionEntry } from "./types.js";

export type SqliteSessionEntryPatchOptions = SessionEntryPatchOptions & {
  /** Cancel waiting admission; a started writer still owns its complete settlement. */
  signal?: AbortSignal;
  /** Closed operations can acknowledge completion without returning the entry. */
  result?: "none";
  /** Exact captured writer under its caller's foreground reservation; never a new owner. */
  retainedExecution?: OmnipolymathAgentDatabaseExecution;
  /** Audited internal updaters: no nested writer admission; guards retain only host authority. */
  workerGuard?: SessionEntryPatchGuard;
  /** A negative current-row selection ends this internal operation before callback preparation. */
  prepareIf?: { kind: "live-model-switch-pending" };
  /** Recheck owner cancellation after async preparation, immediately before committing. */
  shouldCommit?: () => boolean;
  /** Synchronous owner bookkeeping after COMMIT, before identity observers can cancel the caller. */
  onCommitted?: SessionEntryPatchCommitObserver;
  /** Exact source acknowledged by the writer; never discover it after the operation yields. */
  onCommittedSource?: (source: CapturedSessionEntryReadSource, entry: SessionEntry) => void;
};

export type SessionEntryUpdater = (
  entry: SessionEntry,
  context: SessionEntryPatchContext,
) => Promise<Partial<SessionEntry> | null> | Partial<SessionEntry> | null;

export type SqliteSessionEntrySnapshotPatchParams = {
  capturedSource?: CapturedSessionEntryReadSource;
  operationLabel: "session-entry.patch" | "session-entry-target.patch";
  validateCanonicalKeys: boolean;
  options: SqliteSessionEntryPatchOptions;
  selection: SessionEntryPatchSelection;
  readSnapshot: (
    database: OmnipolymathAgentDatabase,
    includeWindowFacts?: true,
  ) => SqliteLifecycleTargetSnapshot;
  resolved: ResolvedSqliteScope;
  sessionKey: string;
  sharedWriteReserved?: boolean;
  storePath: string;
  // Callback preparation precedes BEGIN; fixed operations evaluate the transaction's current rows.
  update: SessionEntryUpdater | SessionEntryPatchOperation;
};

/** Bind entry preparation and commit checks to the original physical store before yielding. */
export function captureSessionEntryPatchSource(params: SqliteSessionEntrySnapshotPatchParams) {
  const { resolved: scope, capturedSource: captured, options } = params;
  const { retainedExecution } = options;
  // Queueing and either cold open must retain the same registration and lease owner.
  const resolved = {
    ...scope,
    env: cloneEnvWithPlatformSemantics(scope.env ?? process.env),
  };
  resolved.env.OMNIPOLYMATH_STATE_DIR = resolveStateDir(resolved.env);
  const databaseOptions = toDatabaseOptions(resolved);
  assertAgentSessionWriteAdmission(databaseOptions, resolved.agentId);
  const databasePath = resolveOmnipolymathAgentSqlitePath(databaseOptions);
  const targetIdentity =
    typeof captured?.databaseIdentity === "string"
      ? {
          key: `file:${captured.databaseIdentity}`,
          canonicalPath: databasePath,
          birthtime: captured.databaseBirthtime,
        }
      : readDatabasePathIdentitySync(databasePath);
  resolved.path = databasePath;
  databaseOptions.path = databasePath;
  const useWorker = isMainThread && supportsOmnipolymathAgentDatabaseExecution(databaseOptions);
  const ensure = options.workerGuard?.ensureIdentitySource;
  if (
    ensure &&
    (!useWorker ||
      typeof params.update === "function" ||
      params.update.kind !== "ensure-identity" ||
      ensure.agentId !== resolved.agentId)
  ) {
    throw new Error("Transaction-local entry authority requires a closed worker ensure");
  }
  if (
    ensure &&
    (targetIdentity.key !== `file:${ensure.source.databaseIdentity}` ||
      targetIdentity.birthtime !== ensure.source.databaseBirthtime)
  ) {
    throw new Error("Transaction-local entry authority differs from its writer");
  }
  const assertCapturedSource = (database?: OmnipolymathAgentDatabase) => {
    if (!captured) {
      return;
    }
    assertCapturedSessionEntryReadSource(
      captured,
      database ?? getOmnipolymathAgentDatabaseIfOpen(databaseOptions),
    );
  };
  const assertCurrent = () => {
    if (retainedExecution) {
      retainedExecution.assertCurrent();
      const identity = retainedExecution.fileIdentity;
      if (
        !captured ||
        !identity ||
        retainedExecution.agentId !== databaseOptions.agentId ||
        captured.databaseIdentity !== identity.physicalIdentity ||
        captured.databaseBirthtime !== identity.birthtime
      ) {
        throw new Error("Retained session writer differs from its acknowledged source");
      }
    }
    if (!useWorker) {
      if (targetIdentity.key.startsWith("file:")) {
        assertExistingDatabaseIdentity(databasePath, targetIdentity.key, targetIdentity.birthtime);
      }
      assertCapturedSource();
    }
  };
  if (retainedExecution) {
    assertCurrent();
  }
  return {
    resolved,
    databaseOptions,
    databasePath,
    targetIdentity,
    useWorker,
    ensureIdentitySource: ensure
      ? { source: ensure.source, agentId: ensure.agentId, sessionKey: ensure.sessionKey }
      : undefined,
    assertCapturedSource,
    assertCurrent,
  };
}
