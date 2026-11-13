import path from "node:path";
import { isRecord, isStringArray } from "@omnipolymath/normalization-core/record-coerce";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { createSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import type { OmnipolymathStateDatabaseReadAdmission } from "../state/omnipolymath-state-db-async-lifecycle.js";
import {
  registerOmnipolymathStateDatabaseAsyncResource,
  registerOmnipolymathStateDatabaseLifecycleListener,
} from "../state/omnipolymath-state-db-cache.js";
import { executeExistingOmnipolymathStateRead } from "../state/omnipolymath-state-db-readonly.js";
import { resolveOmnipolymathStateSqlitePath } from "../state/omnipolymath-state-db.paths.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import { runOmnipolymathStateWorkerOperation } from "../state/omnipolymath-state-worker-store.js";
import type {
  SessionGroupCatalogMutation,
  SessionGroupCatalogMutationResult,
  SessionGroupCatalogAdmission,
  SessionGroupCatalogSnapshot,
  SessionGroupMembershipSnapshot,
} from "./session-group-catalog.types.js";

function isCatalogAdmission(value: unknown): value is SessionGroupCatalogAdmission {
  return (
    isRecord(value) &&
    isStringArray(value.names) &&
    (value.groups === undefined ||
      (Array.isArray(value.groups) &&
        value.groups.every(
          (group) =>
            Array.isArray(group) &&
            group.length === 2 &&
            typeof group[0] === "string" &&
            Array.isArray(group[1]) &&
            group[1].every(
              (target) =>
                isRecord(target) &&
                typeof target.sessionKey === "string" &&
                typeof target.agentId === "string",
            ),
        )))
  );
}

export async function readSessionGroupMembershipInWorker(
  cfg: OmnipolymathConfig,
  env: NodeJS.ProcessEnv,
): Promise<SessionGroupMembershipSnapshot> {
  const result = await executeExistingOmnipolymathStateRead(
    { env },
    { type: "sessionGroups.members", cfg: { agents: cfg.agents, session: cfg.session } },
  );
  if (!result) {
    return { stores: [], groups: [] };
  }
  return result.snapshot;
}

type Catalog = {
  admission?: OmnipolymathStateDatabaseReadAdmission;
  revision: number;
  absent?: boolean;
  snapshot?: SessionGroupCatalogSnapshot;
  reading?: Promise<void>;
  writing?: Promise<unknown>;
};

const catalogs = resolveGlobalSingleton(Symbol.for("omnipolymath.sessionGroupCatalog"), () => {
  const entries = new Map<string, Catalog>();
  const invalidate = (pathname?: string, identityKey?: string) => {
    for (const [key, catalog] of entries) {
      if (
        (!pathname && !identityKey) ||
        pathname === key ||
        (identityKey !== undefined && identityKey === catalog.admission?.identity.key)
      ) {
        catalog.revision += 1;
        catalog.snapshot = undefined;
        entries.delete(key);
      }
    }
  };
  registerOmnipolymathStateDatabaseAsyncResource({
    phase: "after-resources",
    async close(identity) {
      invalidate(identity?.canonicalPath, identity?.key);
    },
  });
  registerOmnipolymathStateDatabaseLifecycleListener((event) => {
    const pathname = event.kind === "opened" ? event.database.path : event.path;
    if (event.kind !== "opened") {
      invalidate(pathname, event.identity?.key);
      return;
    }
    for (const [key, catalog] of entries) {
      if (pathname === key || event.identity.key === catalog.admission?.identity.key) {
        if (catalog.absent || (catalog.reading && !catalog.snapshot)) {
          catalog.revision += 1;
          catalog.snapshot = undefined;
          catalog.absent = false;
        }
      }
    }
  });
  return entries;
});

function catalogFor(env: NodeJS.ProcessEnv): Catalog {
  const pathname = path.resolve(resolveOmnipolymathStateSqlitePath(env));
  let catalog = catalogs.get(pathname);
  if (!catalog) {
    catalog = { revision: 0 };
    catalogs.set(pathname, catalog);
  }
  return catalog;
}

/** Cold admission resolves aliases once; viewers keep borrowing the shared owner directly. */
function bindCatalog(admission: OmnipolymathStateDatabaseReadAdmission): Catalog {
  const current = catalogs.get(admission.databasePath);
  const shared = [...catalogs.values()].find(
    (catalog) => catalog.admission?.identity.key === admission.identity.key,
  );
  const catalog =
    shared ??
    (current && (!current.admission || current.admission.identity.key === admission.identity.key)
      ? current
      : { revision: 0 });
  if (current && current !== catalog) {
    current.revision += 1;
  }
  catalog.admission = admission;
  catalogs.set(admission.databasePath, catalog);
  return catalog;
}

function install(catalog: Catalog, snapshot: SessionGroupCatalogSnapshot, absent = false): void {
  for (const record of [...snapshot.groups, ...snapshot.defaults]) {
    Object.freeze(record);
  }
  Object.freeze(snapshot.groups);
  Object.freeze(snapshot.defaults);
  Object.freeze(snapshot.sectionOrder);
  catalog.snapshot = Object.freeze(snapshot);
  catalog.absent = absent;
}

/** The lifecycle owner refreshes once; synchronous viewers only borrow committed facts. */
export async function ensureSessionGroupCatalog(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (catalogFor(env).snapshot) {
    return;
  }
  const context = captureOmnipolymathStateWorkerContext({ env });
  const catalog = bindCatalog(context.admission);
  while (!catalog.snapshot) {
    if (!catalog.reading) {
      const revision = catalog.revision;
      catalog.reading = (async () => {
        const result = await executeExistingOmnipolymathStateRead(
          { env: context.environment, path: context.admission.databasePath },
          { type: "sessionGroups.snapshot" },
        );
        context.admission.assertCurrent();
        if (catalog.revision !== revision) {
          return;
        }
        if (!result) {
          install(catalog, { groups: [], defaults: [], sectionOrder: [] }, true);
        } else {
          install(catalog, result.snapshot);
        }
      })().finally(() => {
        catalog.reading = undefined;
      });
    }
    await catalog.reading;
    if (catalog !== catalogs.get(context.admission.databasePath)) {
      throw new Error("Session group catalog changed while preparing; retry the request");
    }
  }
}

export function readSessionGroupCatalog(
  env: NodeJS.ProcessEnv = process.env,
): SessionGroupCatalogSnapshot {
  const snapshot = catalogFor(env).snapshot;
  if (!snapshot) {
    throw new Error("Session group catalog is not prepared");
  }
  return snapshot;
}

export function mutateSessionGroupCatalog(
  input: SessionGroupCatalogMutation,
  env: NodeJS.ProcessEnv,
  assertCurrent?: (facts?: SessionGroupCatalogAdmission) => void,
) {
  const mutation = structuredClone(input);
  const context = captureOmnipolymathStateWorkerContext({ env });
  const catalog = bindCatalog(context.admission);
  const write = async (): Promise<SessionGroupCatalogMutationResult> => {
    context.admission.assertCurrent();
    assertCurrent?.();
    // Join preceding mutations before consuming the owner's committed catalog.
    if (
      mutation.kind === "register" &&
      catalog.snapshot?.groups.some(({ name }) => name === mutation.name)
    ) {
      return { changed: false, snapshot: catalog.snapshot };
    }
    // A concurrent initial read must not reinstall facts from before this commit.
    catalog.revision += 1;
    try {
      const result = await runOmnipolymathStateWorkerOperation(
        context,
        (scope) => scope.execute({ type: "sessionGroups.mutate", input: mutation }),
        {
          assertCurrent: () => assertCurrent?.(),
          createAdmission() {
            return {
              nativeLocations: [context.admission.databasePath],
              admission: createSqliteWorkerOperationAdmission((request, grant) => {
                context.admission.assertCurrent();
                if (request.stage === "transaction") {
                  if (!isCatalogAdmission(request.facts)) {
                    throw new Error("Session group transaction omitted catalog authority");
                  }
                  assertCurrent?.(request.facts);
                } else {
                  assertCurrent?.();
                }
                grant();
              }),
            };
          },
        },
      );
      context.admission.assertCurrent();
      assertCurrent?.();
      catalog.revision += 1;
      install(catalog, result.snapshot);
      return result;
    } catch (error) {
      catalog.revision += 1;
      catalog.snapshot = undefined;
      try {
        context.admission.assertCurrent();
        await ensureSessionGroupCatalog(context.environment);
      } catch {
        // The next request must prepare again when the original database cannot be reconciled.
      }
      throw error;
    }
  };
  const result = catalog.writing ? catalog.writing.then(write, write) : write();
  catalog.writing = result;
  void result
    .finally(() => {
      if (catalog.writing === result) {
        catalog.writing = undefined;
      }
    })
    .catch(() => {});
  return result;
}
