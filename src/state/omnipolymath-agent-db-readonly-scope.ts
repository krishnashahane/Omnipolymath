import { AsyncLocalStorage } from "node:async_hooks";
import { normalizeAgentId } from "@omnipolymath/normalization-core/agent-id";
import { registerProcessExitCleanup } from "../infra/process-exit-cleanup.js";
import { isPostgresSqlConnection, type EngineConnection } from "../infra/sql-connection.js";
import { SQLITE_IDLE_HANDLE_TTL_MS } from "../infra/sqlite-handle-lifecycle.js";
import { runSqliteReadOperationSync } from "../infra/sqlite-schema-facts.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { runInDetachedAsyncContext } from "../shared/detached-async-context.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import type { OmnipolymathAgentDatabaseOptions } from "./omnipolymath-agent-db-contract.js";
import {
  createOmnipolymathAgentDatabaseClaim,
  isOmnipolymathAgentDatabasePathCurrent,
  findOmnipolymathAgentDatabaseIdentity,
} from "./omnipolymath-agent-db-identity.js";
import {
  openOmnipolymathAgentDatabaseReadOnly,
  readOmnipolymathAgentDatabase,
  readOmnipolymathAgentDatabaseSnapshot,
  withFreshOmnipolymathAgentDatabaseReadOnly,
  type OmnipolymathAgentDatabaseReadOnlyResult,
  type OmnipolymathAgentReadOnlyDatabase,
  type OmnipolymathAgentReadOnlyDatabaseHandle,
} from "./omnipolymath-agent-db-readonly-open.js";
import { registerOmnipolymathAgentDatabaseSyncResource } from "./omnipolymath-agent-db-resources.js";
import { assertAgentDatabaseTerminalOpenAllowed } from "./omnipolymath-agent-db-terminal.js";
import {
  adoptOmnipolymathAgentDatabaseValidation,
  getOmnipolymathAgentDatabaseValidation,
  type OmnipolymathAgentDatabaseReadValidation,
} from "./omnipolymath-agent-db-validation-cache.js";
import { observeOmnipolymathDatabaseMaintenanceResource } from "./omnipolymath-state-db-async-lifecycle.js";

export type OmnipolymathAgentDatabaseReadOnlyBehavior = {
  allowExtension?: boolean;
  /** Consume admission and read kernels in one synchronous deferred transaction. */
  snapshot?: boolean;
};

type ReadTarget = OmnipolymathAgentDatabaseOptions & { agentId: string; path: string };
type ReadScopeTarget = {
  agentId: string;
  path: string;
  validation?: OmnipolymathAgentDatabaseReadValidation;
};
const readOnlyScope = new AsyncLocalStorage<OmnipolymathAgentDatabaseReadOnlyScope>();
const log = createSubsystemLogger("state/agent-db");
type ReadOnlyScopes = {
  paths: Map<string, OmnipolymathAgentDatabaseReadOnlyScope>;
  active: Set<OmnipolymathAgentDatabaseReadOnlyScope>;
  unregisterExit?: () => void;
};
const retainedScopes = resolveGlobalSingleton<ReadOnlyScopes>(
  Symbol.for("omnipolymath.agentDatabaseReadOnlyScopes"),
  () => ({ paths: new Map(), active: new Set() }),
);

/** One logical reader, revoked by its caller, database lifecycle, or idle expiry. */
export class OmnipolymathAgentDatabaseReadOnlyScope {
  private database?: OmnipolymathAgentReadOnlyDatabaseHandle;
  private retainedValidation?: OmnipolymathAgentDatabaseReadValidation;
  private target?: ReadScopeTarget;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private unregisterResource?: () => void;
  private borrowers = 0;

  constructor(private readonly cached = false) {}

  get hasRetainedConnection(): boolean {
    return this.database !== undefined;
  }

  invalidateProjection(
    databaseIdentity: string,
    invalidate: (database: EngineConnection) => void,
  ): void {
    if (
      this.database &&
      findOmnipolymathAgentDatabaseIdentity(this.database)?.identity === databaseIdentity
    ) {
      invalidate(this.database.db);
    }
  }

  closeIfIdle(): void {
    if (this.borrowers === 0 && (!this.database?.db.isOpen || !this.database.db.isTransaction)) {
      this.discardConnection();
    }
  }

  close(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    this.database?.close();
    this.database = undefined;
    this.retainedValidation = undefined;
    this.borrowers = 0;
    if (this.target && retainedScopes.paths.get(this.target.path) === this) {
      retainedScopes.paths.delete(this.target.path);
    }
    // Descendant async contexts retain this object after run returns. Revoke reuse first.
    this.target = undefined;
    this.unregisterResource?.();
    this.unregisterResource = undefined;
    retainedScopes.active.delete(this);
    if (retainedScopes.active.size === 0) {
      retainedScopes.unregisterExit?.();
      retainedScopes.unregisterExit = undefined;
    }
  }

  private discardConnection(): void {
    const target = this.target;
    this.close();
    // Replacing a connection does not end the caller's still-active read scope.
    if (!this.cached) {
      this.target = target;
    }
  }

  private touch(): void {
    if (!this.database) {
      return;
    }
    if (this.idleTimer) {
      this.idleTimer.refresh();
      return;
    }
    this.idleTimer = runInDetachedAsyncContext(() =>
      setTimeout(() => {
        this.idleTimer = undefined;
        try {
          this.closeIfIdle();
        } catch (error) {
          log.warn("Idle agent read-only database cleanup failed", {
            path: this.database?.path,
            error,
          });
        } finally {
          this.touch();
        }
      }, SQLITE_IDLE_HANDLE_TTL_MS),
    );
    this.idleTimer.unref();
  }

  run<T>(target: ReadScopeTarget, operation: () => T): T {
    if (this.target?.agentId !== target.agentId || this.target.path !== target.path) {
      this.close();
    }
    this.target = target;
    return readOnlyScope.run(this, operation);
  }

  matches(agentId: string, pathname: string): boolean {
    return this.target?.agentId === agentId && this.target.path === pathname;
  }

  private acquire(options: OmnipolymathAgentDatabaseOptions) {
    const finish = (database: OmnipolymathAgentReadOnlyDatabaseHandle) => {
      const requestedAgentId = normalizeAgentId(options.agentId);
      if (database.agentId !== requestedAgentId) {
        throw new Error(
          `Omnipolymath agent database ${database.path} belongs to agent ${database.agentId}; requested agent ${requestedAgentId}.`,
        );
      }
      observeOmnipolymathDatabaseMaintenanceResource(this.unregisterResource);
      this.touch();
      return { found: true, database } as const;
    };
    if (
      this.database &&
      ((this.retainedValidation &&
        Atomics.load(new Int32Array(this.retainedValidation.valid), 0) !== 1) ||
        !isOmnipolymathAgentDatabasePathCurrent(this.database))
    ) {
      this.discardConnection();
    }
    if (this.database) {
      assertAgentDatabaseTerminalOpenAllowed(this.database.path);
    }
    if (!this.database) {
      const opened = openOmnipolymathAgentDatabaseReadOnly(options);
      if (!opened.found) {
        this.discardConnection();
        return opened;
      }
      this.database = opened.database;
      this.target = { ...this.target, agentId: this.database.agentId, path: this.database.path };
      try {
        this.unregisterResource = registerOmnipolymathAgentDatabaseSyncResource({
          agentId: this.target.agentId,
          path: this.target.path,
          revoke: () => this.close(),
          close: () => this.close(),
        });
        retainedScopes.active.add(this);
        if (this.cached) {
          retainedScopes.paths.set(this.database.path, this);
        }
        retainedScopes.unregisterExit ??= registerProcessExitCleanup(() => {
          for (const scope of retainedScopes.active) {
            scope.close();
          }
        });
      } catch (error) {
        this.discardConnection();
        throw error;
      }
    }
    const database = this.database;
    const validation = this.target?.validation;
    if (validation && !adoptOmnipolymathAgentDatabaseValidation(database, validation)) {
      throw new Error("Session reader validation does not match its current physical owner");
    }
    // Later requests can carry a successor receipt while this connection still owns the old one.
    this.retainedValidation ??= getOmnipolymathAgentDatabaseValidation(database);
    // The open owner validates the schema once; runtime reads retain that admission.
    return finish(database);
  }

  private releaseBorrow(database: OmnipolymathAgentReadOnlyDatabaseHandle): void {
    if (this.database !== database) {
      return;
    }
    this.borrowers--;
    if (this.borrowers === 0 && isPostgresSqlConnection(database.db)) {
      database.db.releaseIdleTransport();
    }
    if (
      this.cached &&
      this.borrowers === 0 &&
      this.database &&
      (!this.database.db.isOpen || this.database.db.isTransaction)
    ) {
      this.discardConnection();
    } else {
      this.touch();
    }
  }

  retain(options: OmnipolymathAgentDatabaseOptions) {
    const opened =
      this.database?.db.isOpen && this.database.db.isTransaction
        ? openOmnipolymathAgentDatabaseReadOnly(options)
        : this.acquire(options);
    if (!opened.found) {
      return opened;
    }
    const { database } = opened;
    const shared = database === this.database;
    if (shared) {
      this.borrowers++;
    }
    return {
      found: true,
      database,
      claim: createOmnipolymathAgentDatabaseClaim(database, () => {
        if (shared) {
          this.releaseBorrow(database);
        } else {
          database.close();
        }
      }),
    } as const;
  }

  read<T>(
    operation: (database: OmnipolymathAgentReadOnlyDatabase) => T,
    options: OmnipolymathAgentDatabaseOptions,
    behavior: OmnipolymathAgentDatabaseReadOnlyBehavior = {},
  ): OmnipolymathAgentDatabaseReadOnlyResult<T> {
    if (this.database?.db.isOpen && this.database.db.isTransaction) {
      return withFreshOmnipolymathAgentDatabaseReadOnly(operation, options, behavior);
    }
    const opened = this.acquire(options);
    if (!opened.found) {
      return opened;
    }
    const { database } = opened;
    this.borrowers++;
    try {
      return behavior.snapshot
        ? readOmnipolymathAgentDatabaseSnapshot(database, operation)
        : runSqliteReadOperationSync(database.db, () =>
            readOmnipolymathAgentDatabase(database, operation),
          );
    } catch (error) {
      if (this.cached && this.borrowers === 1) {
        this.discardConnection();
      }
      throw error;
    } finally {
      this.releaseBorrow(database);
    }
  }
}

function cachedScope(options: ReadTarget): OmnipolymathAgentDatabaseReadOnlyScope {
  let scope = retainedScopes.paths.get(options.path);
  if (!scope) {
    scope = new OmnipolymathAgentDatabaseReadOnlyScope(true);
    scope.run(options, () => {});
    retainedScopes.paths.set(options.path, scope);
  }
  return scope;
}

/** Committed worker receipts invalidate projections on retained readers without running SQL. */
export function invalidateOmnipolymathAgentReadOnlyProjections(
  databaseIdentity: string,
  invalidate: (database: EngineConnection) => void,
): void {
  for (const scope of retainedScopes.active) {
    scope.invalidateProjection(databaseIdentity, invalidate);
  }
}

/** Writable admission retires an idle reader before opening the same physical file. */
export function closeIdleOmnipolymathAgentDatabaseReadOnly(pathname: string): void {
  retainedScopes.paths.get(pathname)?.closeIfIdle();
}

export function retainCachedOmnipolymathAgentDatabaseReadOnly(options: ReadTarget) {
  return cachedScope(options).retain(options);
}

/** Reuse the caller's matching read scope, or this thread's idle-expiring reader. */
export function withScopedOmnipolymathAgentDatabaseReadOnly<T>(
  operation: (database: OmnipolymathAgentReadOnlyDatabase) => T,
  options: ReadTarget,
  behavior: OmnipolymathAgentDatabaseReadOnlyBehavior = {},
): OmnipolymathAgentDatabaseReadOnlyResult<T> {
  if (behavior.allowExtension) {
    return withFreshOmnipolymathAgentDatabaseReadOnly(operation, options, behavior);
  }
  const scope = readOnlyScope.getStore();
  return (scope?.matches(options.agentId, options.path) ? scope : cachedScope(options)).read(
    operation,
    options,
    behavior,
  );
}
