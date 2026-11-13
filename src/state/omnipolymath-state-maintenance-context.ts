import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import { resolveIdentityPathViaExistingAncestorSync } from "../infra/boundary-path.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";

export type MaintenanceResource = {
  phase:
    | "agent-resources"
    | "agent-handles"
    | "shared-leases"
    | "shared-resources"
    | "shared-references"
    | "shared-handles";
  close: () => void | Promise<void>;
};

export type AgentSchemaMigration = {
  agentId: string;
  path: string;
  foundVersion: number;
  supportedVersion: number;
};

export type OmnipolymathDatabaseMaintenanceScope = {
  readonly ownsSchemaMaintenance: boolean;
  /** SQLite admission coverage for this offline Doctor operation; absent at runtime. */
  readonly sqliteIntegrityCheck?: "quick" | "full";
  assertOwnerCurrent(this: void, access?: "read"): void;
  assertDatabaseAccess(this: void, databasePath: string): void;
  assertCleanupDatabaseAccess(this: void, databasePath: string): void;
  assertAdmission(this: void): void;
  assertReadAdmission(this: void): void;
  addAgentSchemaMigrationCheck(check: (migration: AgentSchemaMigration) => void): void;
  assertAgentSchemaMigration(migration: AgentSchemaMigration): void;
  run<T>(operation: () => T): T;
  track<T>(operation: Promise<T>): Promise<T>;
  own(
    resource: object,
    phase: MaintenanceResource["phase"],
    close: MaintenanceResource["close"],
  ): void;
  close(beforeResources?: () => void | Promise<void>): Promise<void>;
};

const liveAuthorityReads = resolveGlobalSingleton(
  Symbol.for("omnipolymath.maintenanceLiveAuthorityReads"),
  () => new WeakMap<OmnipolymathDatabaseMaintenanceScope, Set<string>>(),
);

export function allowsMaintenanceLiveAuthorityReads(
  scope: OmnipolymathDatabaseMaintenanceScope,
  pathname: string,
): boolean {
  const canonicalPath = resolveIdentityPathViaExistingAncestorSync(pathname);
  for (
    let current: OmnipolymathDatabaseMaintenanceScope | undefined = scope;
    current;
    current = maintenanceResources.parents.get(current)
  ) {
    if (liveAuthorityReads.get(current)?.has(canonicalPath)) {
      return true;
    }
  }
  return false;
}

/** Raw source descriptor closes are safe only before maintenance admits native source reads. */
export function maintenanceOwnerHasSourceCustody(
  scope: OmnipolymathDatabaseMaintenanceScope | undefined,
  pathname: string,
): boolean {
  if (!scope?.ownsSchemaMaintenance) {
    return false;
  }
  scope.assertReadAdmission();
  return !allowsMaintenanceLiveAuthorityReads(scope, pathname);
}

const MAINTENANCE_IN_PROCESS_COPY_MAX_BYTES = 64 * 1024 * 1024;

export function maintenanceOwnerMayCopySourcesInProcess(
  scope: OmnipolymathDatabaseMaintenanceScope | undefined,
  pathname: string,
): boolean {
  if (!maintenanceOwnerHasSourceCustody(scope, pathname)) {
    return false;
  }
  // Larger families keep the cancellable isolated child so a slow copy cannot pin Doctor's main thread.
  let bytes = 0;
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    bytes += fs.statSync(`${pathname}${suffix}`, { throwIfNoEntry: false })?.size ?? 0;
    if (bytes > MAINTENANCE_IN_PROCESS_COPY_MAX_BYTES) {
      return false;
    }
  }
  return true;
}

export const maintenanceResources = resolveGlobalSingleton(
  Symbol.for("omnipolymath.databaseMaintenanceResources"),
  () => ({
    current: new AsyncLocalStorage<{
      scope: OmnipolymathDatabaseMaintenanceScope;
      active: boolean;
      workerAccess?: boolean;
    }>(),
    claims: new WeakMap<
      object,
      MaintenanceResource & { scope: OmnipolymathDatabaseMaintenanceScope; release: () => void }
    >(),
    parents: new WeakMap<OmnipolymathDatabaseMaintenanceScope, OmnipolymathDatabaseMaintenanceScope>(),
  }),
);

export function getOmnipolymathDatabaseMaintenanceScope():
  | OmnipolymathDatabaseMaintenanceScope
  | undefined {
  return maintenanceResources.current.getStore()?.scope;
}

/** Background work retains command custody without borrowing its native execution path. */
export function isOmnipolymathDatabaseMaintenanceWorkerAccess(): boolean {
  return maintenanceResources.current.getStore()?.workerAccess === true;
}

/** Doctor selects live source reads only after its pre-mutation backup boundary. */
export function admitOmnipolymathMaintenanceLiveAuthorityReads(pathname: string): void {
  const scope = getOmnipolymathDatabaseMaintenanceScope();
  if (!scope?.ownsSchemaMaintenance) {
    throw new Error("Live authority reads require database maintenance ownership");
  }
  scope.assertDatabaseAccess(pathname);
  let admitted = liveAuthorityReads.get(scope);
  if (!admitted) {
    admitted = new Set();
    liveAuthorityReads.set(scope, admitted);
  }
  admitted.add(resolveIdentityPathViaExistingAncestorSync(pathname));
}

/** Delayed work acquires its own resources instead of inheriting the completed scope. */
export function runOutsideOmnipolymathDatabaseMaintenanceScope<T>(operation: () => T): T {
  return maintenanceResources.current.exit(operation);
}

export function isOmnipolymathDatabaseMaintenanceResourceOwned(
  resource: object,
  scope: OmnipolymathDatabaseMaintenanceScope,
): boolean {
  return maintenanceResources.claims.get(resource)?.scope === scope;
}

export function getOmnipolymathDatabaseMaintenanceResourceScope(
  resource: object,
): OmnipolymathDatabaseMaintenanceScope | undefined {
  return maintenanceResources.claims.get(resource)?.scope;
}

export function runMaintenance<T>(
  scope: OmnipolymathDatabaseMaintenanceScope,
  operation: () => T,
  workerAccess = isOmnipolymathDatabaseMaintenanceWorkerAccess(),
): T {
  const accepted = { scope, active: true, workerAccess };
  try {
    const result = maintenanceResources.current.run(accepted, operation);
    if (result instanceof Promise) {
      const settled = () => {
        accepted.active = false;
      };
      void result.then(settled, settled);
      void scope.track(result);
    } else {
      accepted.active = false;
    }
    return result;
  } catch (error) {
    accepted.active = false;
    throw error;
  }
}

/** Retain one exact resource claim for finite commands while its maintenance scope drains. */
export function captureOmnipolymathDatabaseMaintenanceResource(
  resource: object,
  expectedScope: OmnipolymathDatabaseMaintenanceScope,
) {
  const claim = maintenanceResources.claims.get(resource);
  const assertCurrent = () => {
    expectedScope.assertOwnerCurrent();
    if (claim?.scope !== expectedScope || maintenanceResources.claims.get(resource) !== claim) {
      throw new Error("Database maintenance resource owner changed");
    }
  };
  assertCurrent();
  return {
    assertCurrent,
    async run<T>(operation: () => Promise<T>): Promise<T> {
      assertCurrent();
      return runMaintenance(expectedScope, operation);
    },
    async runWorker<T>(operation: () => Promise<T>): Promise<T> {
      assertCurrent();
      return runMaintenance(expectedScope, operation, true);
    },
  };
}

/** A cached handle used by an independent caller remains with the ordinary cache owner. */
export function observeOmnipolymathDatabaseMaintenanceResource(resource: object | undefined): void {
  if (!resource) {
    return;
  }
  const claim = maintenanceResources.claims.get(resource);
  const current = getOmnipolymathDatabaseMaintenanceScope();
  if (!claim) {
    return;
  }
  const owner = commonMaintenanceAncestor(claim.scope, current);
  if (owner === claim.scope) {
    return;
  }
  claim.scope.assertAdmission();
  claim.release();
  maintenanceResources.claims.delete(resource);
  if (owner) {
    owner.own(resource, claim.phase, claim.close);
  }
}

function commonMaintenanceAncestor(
  owner: OmnipolymathDatabaseMaintenanceScope,
  scope: OmnipolymathDatabaseMaintenanceScope | undefined,
): OmnipolymathDatabaseMaintenanceScope | undefined {
  const ancestors = new Set<OmnipolymathDatabaseMaintenanceScope>();
  for (
    let current: OmnipolymathDatabaseMaintenanceScope | undefined = owner;
    current;
    current = maintenanceResources.parents.get(current)
  ) {
    ancestors.add(current);
  }
  for (let current = scope; current; current = maintenanceResources.parents.get(current)) {
    if (ancestors.has(current)) {
      return current;
    }
  }
  return undefined;
}
