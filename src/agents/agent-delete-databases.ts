import path from "node:path";
import { memorySessionActorOwners } from "../config/sessions/session-actor-memory-owner.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { isPathInside } from "../infra/path-guards.js";
import { resolveSqliteDatabaseFilePaths } from "../infra/sqlite-files.js";
import {
  runSqliteReadOnlyOperation,
  withSqliteReadOnlyWorkerScope,
} from "../infra/sqlite-readonly-worker.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { assertNoAgentDatabaseLeasesAsync } from "../state/agent-deletion-journal.js";
import type { OmnipolymathRegisteredAgentDatabase } from "../state/omnipolymath-agent-db-contract.js";
import { prepareOmnipolymathAgentDatabaseRegistrySnapshotRead } from "../state/omnipolymath-agent-db-registry-listing.js";
import {
  closeOmnipolymathAgentDatabaseByPathAsync,
  resolveIncognitoOmnipolymathAgentSqlitePath,
  resolveOmnipolymathAgentSqlitePath,
} from "../state/omnipolymath-agent-db.js";
import type { OmnipolymathStateDatabaseOptions } from "../state/omnipolymath-state-db-contract.js";
import { executeExistingOmnipolymathStateRead } from "../state/omnipolymath-state-db-readonly.js";
import { captureOmnipolymathStateReadWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import { findOverlappingWorkspaceAgentIds } from "./agent-delete-safety.js";
import { assertAgentSessionStoreDeletionBlocker } from "./agent-delete-session-store-safety.js";
import {
  assertAgentSessionStoreDeletionTargetsCurrent,
  prepareAgentSessionStoreDeletionSafety,
} from "./agent-delete-session-store-safety.targets.js";
import {
  isPathOwnedByAnotherRegisteredAgent,
  normalizeAgentDirRegistryPath,
  registerResolvedAgentDir,
  resolveRegisteredAgentIdForDir,
  unregisterResolvedAgentDir,
} from "./agent-dir-registry.js";
import type { AgentDeletionOperation } from "./agent-lifecycle-registry.js";
import { listAgentIds, resolveAgentDir } from "./agent-scope.js";
import { closeAuthProfileReadPool } from "./auth-profiles/sqlite-read-pool.js";

export { AgentSharedStoreOwnerError } from "./agent-delete-session-store-safety.js";

function resolveAgentDeleteRuntimeDirs(
  agentId: string,
  agentDir: string,
  registeredDatabases: readonly OmnipolymathRegisteredAgentDatabase[],
): string[] {
  const normalizedId = normalizeAgentId(agentId);
  return [
    agentDir,
    ...registeredDatabases
      .filter((entry) => normalizeAgentId(entry.agentId) === normalizedId)
      .map((entry) => path.dirname(entry.path)),
  ];
}

function resolveAgentDeleteDatabasePaths(
  agentId: string,
  agentDir: string,
  registeredPaths: readonly string[],
  env?: NodeJS.ProcessEnv,
): Set<string> {
  return new Set([
    resolveOmnipolymathAgentSqlitePath({ agentId, env }),
    resolveOmnipolymathAgentSqlitePath({
      agentId,
      env,
      path: path.join(agentDir, "omnipolymath-agent.sqlite"),
    }),
    ...registeredPaths,
  ]);
}

/** Settle admitted usage cleanup before the journal retires native execution owners. */
export async function drainAgentDeleteDatabaseWork(
  deletion: AgentDeletionOperation,
  options: OmnipolymathStateDatabaseOptions = {},
): Promise<void> {
  const { retireSessionHistoryWorkerDatabases } =
    await import("../config/sessions/session-transcript-worker-resources.js");
  const { agentId, agentDir, databasePaths } = deletion.entry;
  await deletion.assertCurrentAsync();
  await retireSessionHistoryWorkerDatabases({
    agentId,
    paths: [
      ...resolveAgentDeleteDatabasePaths(agentId, agentDir, databasePaths, options.env),
      resolveIncognitoOmnipolymathAgentSqlitePath({ agentId, env: options.env }),
    ],
  });
  await deletion.assertCurrentAsync();
}

export async function retireAgentDeleteRuntime(
  deletion: AgentDeletionOperation,
  agentDirs: readonly string[],
): Promise<void> {
  const agentId = deletion.entry.agentId;
  const { retirePreparedModelRuntimeAgent } = await import("./prepared-model-runtime.js");
  await deletion.assertCurrentAsync();
  await retirePreparedModelRuntimeAgent({ agentId, agentDirs });
  await deletion.assertCurrentAsync();
}

export async function finishAgentDeleteDatabases(params: {
  deletion: AgentDeletionOperation;
  agentDir: string;
  deleteFiles: boolean;
  complete: boolean;
}): Promise<void> {
  const { deletion, agentDir, deleteFiles, complete } = params;
  await deletion.assertCurrentAsync();
  if (!complete) {
    return;
  }
  const agentId = deletion.entry.agentId;
  unregisterResolvedAgentDir({ agentId, agentDir });
  await deletion.finish({ unregisterDatabases: deleteFiles });
}

/** Destructive planning includes every registered owner, regardless of runtime schema readiness. */
export async function readAgentDeleteDatabaseRegistry(options: OmnipolymathStateDatabaseOptions = {}) {
  const read = await prepareOmnipolymathAgentDatabaseRegistrySnapshotRead({
    ...options,
    includeIncompatibleSchemaVersions: true,
    fresh: true,
  }).read();
  read.assertCurrent();
  if (read.result.status !== "available") {
    throw new Error("Omnipolymath agent database registry is unavailable during deletion.");
  }
  return read.result.entries;
}

export function prepareJournaledAgentDirOwnership(
  cfg: OmnipolymathConfig,
  agentId: string,
  agentDir: string,
): void {
  for (const configuredAgentId of listAgentIds(cfg)) {
    resolveAgentDir(cfg, configuredAgentId);
  }
  const registeredOwner = resolveRegisteredAgentIdForDir(agentDir);
  if (registeredOwner !== undefined) {
    return;
  }
  // The durable journal retains ownership across restarts after the roster entry is gone.
  registerResolvedAgentDir({ agentId, agentDir });
}

/** Check before journaling: retaining the file alone would still fence its shared owner. */
export async function assertAgentSessionStoreDeletionSafe(
  cfg: OmnipolymathConfig,
  agentId: string,
  options: OmnipolymathStateDatabaseOptions = {},
): Promise<void> {
  if (!cfg.session?.store?.trim()) {
    return;
  }
  const input = prepareAgentSessionStoreDeletionSafety(cfg, agentId, options.env ?? process.env);
  const context = captureOmnipolymathStateReadWorkerContext({
    path: options.database?.path ?? options.path,
    env: input.env,
  });
  const reply = await executeExistingOmnipolymathStateRead(
    { path: context.admission.databasePath, env: context.environment },
    {
      type: "agentDeletion.sessionStoreBlocker",
      input: {
        ...input,
        databasePath: context.admission.databasePath,
        env: context.environment,
      },
    },
    { context, current: true },
  );
  context.admission.assertCurrent();
  assertAgentSessionStoreDeletionTargetsCurrent(input.targets);
  let blocker = reply?.blocker;
  if (!reply) {
    const anchor = input.targets.candidates.find(({ identity }) =>
      identity.key.startsWith("file:"),
    );
    if (anchor) {
      const result = await withSqliteReadOnlyWorkerScope(() =>
        runSqliteReadOnlyOperation(
          anchor.identity.canonicalPath,
          { type: "agentRetirement.sessionStoreBlocker", input },
          { source: "canonical", expectedIdentity: anchor.identity.key, env: input.env },
        ),
      );
      context.admission.assertCurrent();
      assertAgentSessionStoreDeletionTargetsCurrent(input.targets);
      blocker = result.blocker;
    }
  }
  assertAgentSessionStoreDeletionBlocker(input.agentId, blocker);
}

export function resolveSurvivingDatabaseFilePaths(
  registeredDatabases: readonly OmnipolymathRegisteredAgentDatabase[],
  agentId: string,
  env?: NodeJS.ProcessEnv,
): string[] {
  return [
    ...new Set(
      registeredDatabases
        .filter((entry) => normalizeAgentId(entry.agentId) !== agentId)
        .flatMap((entry) => resolveSqliteDatabaseFilePaths(entry.path))
        .map((pathname) => normalizeAgentDirRegistryPath(pathname, env)),
    ),
  ];
}

export function isPathOwnedBySurvivingAgent(
  cfg: OmnipolymathConfig,
  agentId: string,
  pathname: string,
  survivingDatabaseFilePaths: readonly string[] = [],
  env?: NodeJS.ProcessEnv,
): boolean {
  const canonicalPath = normalizeAgentDirRegistryPath(pathname, env);
  return (
    isPathOwnedByAnotherRegisteredAgent({ agentId, pathname, env }) ||
    findOverlappingWorkspaceAgentIds(cfg, agentId, pathname, env).length > 0 ||
    survivingDatabaseFilePaths.some(
      (databasePath) =>
        databasePath === canonicalPath ||
        isPathInside(databasePath, canonicalPath) ||
        isPathInside(canonicalPath, databasePath),
    )
  );
}

export async function prepareAgentDeleteDatabases(
  cfg: OmnipolymathConfig,
  agentId: string,
  agentDir: string,
  options: OmnipolymathStateDatabaseOptions = {},
  deletion?: AgentDeletionOperation,
) {
  const registeredDatabases = await readAgentDeleteDatabaseRegistry(options);
  const survivingDatabaseFilePaths = resolveSurvivingDatabaseFilePaths(
    registeredDatabases,
    agentId,
    options.env,
  );
  const registeredDatabasePaths = resolveAgentDeleteDatabasePaths(
    agentId,
    agentDir,
    registeredDatabases
      .filter((entry) => normalizeAgentId(entry.agentId) === agentId)
      .map((entry) => entry.path),
    options.env,
  );
  // A surviving directory retains files, not the deleted agent's connection. Check the
  // actual cached owner so stale registration cannot close a surviving agent's handle.
  for (const databasePath of registeredDatabasePaths) {
    if (deletion) {
      await deletion.assertCurrentAsync();
    }
    await closeOmnipolymathAgentDatabaseByPathAsync(databasePath, agentId);
  }
  // Incognito has no registry row or files; deleting its agent discards the memory owner.
  if (deletion) {
    await deletion.assertCurrentAsync();
  }
  memorySessionActorOwners.closeDatabase({
    agentId,
    path: resolveIncognitoOmnipolymathAgentSqlitePath({ agentId, env: options.env }),
  });
  const databasePaths = [...registeredDatabasePaths].filter((pathname) =>
    resolveSqliteDatabaseFilePaths(pathname).every(
      (filePath) =>
        !isPathOwnedBySurvivingAgent(
          cfg,
          agentId,
          filePath,
          survivingDatabaseFilePaths,
          options.env,
        ),
    ),
  );
  if (deletion) {
    await deletion.assertCurrentAsync();
  }
  for (const databasePath of databasePaths) {
    closeAuthProfileReadPool({ kind: "database", databasePath });
  }
  if (deletion) {
    await deletion.runWithWorker((scope, guard) =>
      scope.execute({ type: "agentDeletion.assertNoDatabaseLeases", input: { guard } }),
    );
  } else {
    await assertNoAgentDatabaseLeasesAsync(agentId, options);
  }
  const fileGroups = databasePaths.map(resolveSqliteDatabaseFilePaths);
  const relocatedFileGroups = fileGroups.filter((fileGroup) => {
    const relative = path.relative(agentDir, fileGroup[0] ?? agentDir);
    return relative.startsWith("..") || path.isAbsolute(relative);
  });
  return {
    agentDirs: resolveAgentDeleteRuntimeDirs(agentId, agentDir, registeredDatabases),
    registrationPaths: [...registeredDatabasePaths],
    // Stale registrations can name a survivor's database; path-only readers must exclude it.
    readerPaths: databasePaths,
    fileGroups,
    relocatedFileGroups,
  };
}
