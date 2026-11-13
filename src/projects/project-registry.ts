import fs from "node:fs/promises";
import path from "node:path";
import { withAgentRosterFactsBatch } from "../agents/agent-scope-config.js";
import { listAgentIds, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import type { OmnipolymathStateDatabaseOptions } from "../state/omnipolymath-state-db.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import type { OmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.types.js";
import { withProjectCheckoutLifecycle } from "./project-checkout.js";
import {
  prepareProjectRegistration,
  registerPreparedProjectRegistry,
} from "./project-registration.js";
import type { ProjectRegistryIdentity, ProjectRegistryRecord } from "./project-registry.types.js";
import { isWorkspaceProjectId, WORKSPACE_PROJECT_ID_PREFIX } from "./workspace-project-id.js";

export {
  ProjectCheckoutError,
  resolveProjectCheckout,
  resolveProjectDirectory,
} from "./project-checkout.js";

function workspaceProject(cfg: OmnipolymathConfig, agentId: string): ProjectRegistryRecord {
  const repoRoot = resolveAgentWorkspaceDir(cfg, agentId);
  return {
    id: `${WORKSPACE_PROJECT_ID_PREFIX}${agentId}`,
    displayName: path.basename(repoRoot) || agentId,
    repoRoot,
    source: "workspace",
    agentId,
  };
}

function compareProjects(left: ProjectRegistryRecord, right: ProjectRegistryRecord): number {
  const leftName = left.displayName.toLowerCase();
  const rightName = right.displayName.toLowerCase();
  if (leftName !== rightName) {
    return leftName < rightName ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export async function registerProjectRegistry(
  input: { path: string; name?: string },
  options: Pick<OmnipolymathStateDatabaseOptions, "path" | "env"> = {},
): Promise<ProjectRegistryRecord> {
  const env = cloneEnvWithPlatformSemantics(options.env ?? process.env);
  const context = captureOmnipolymathStateWorkerContext({ path: options.path, env });
  const prepared = await prepareProjectRegistration({ ...input, source: "registered" });
  return await withProjectCheckoutLifecycle(
    prepared.project.repoRoot,
    { path: context.admission.databasePath, env },
    (lease) => registerPreparedProjectRegistry(prepared, lease, context),
  );
}

export function listWorkspaceProjects(cfg: OmnipolymathConfig): ProjectRegistryRecord[] {
  return withAgentRosterFactsBatch(cfg, () =>
    listAgentIds(cfg)
      .map((agentId) => workspaceProject(cfg, agentId))
      .toSorted(compareProjects),
  );
}

export async function listProjectRegistry(
  cfg: OmnipolymathConfig,
  options: Pick<OmnipolymathStateDatabaseOptions, "path" | "env"> = {},
): Promise<ProjectRegistryRecord[]> {
  const context = captureOmnipolymathStateWorkerContext(options);
  const workspaces = listWorkspaceProjects(cfg);
  const { executeExistingOmnipolymathStateRead } =
    await import("../state/omnipolymath-state-db-readonly.js");
  const stored = await executeExistingOmnipolymathStateRead(
    { path: context.admission.databasePath, env: context.environment },
    { type: "projects.list", input: undefined },
    { context, current: true },
  );
  return [...workspaces, ...(stored?.projects ?? [])].toSorted(compareProjects);
}

export function resolveWorkspaceProject(
  cfg: OmnipolymathConfig,
  id: string,
): ProjectRegistryRecord | undefined {
  if (!isWorkspaceProjectId(id)) {
    return undefined;
  }
  const agentId = id.slice(WORKSPACE_PROJECT_ID_PREFIX.length);
  return listAgentIds(cfg).includes(agentId) ? workspaceProject(cfg, agentId) : undefined;
}

export async function resolveProjectRegistry(
  cfg: OmnipolymathConfig,
  id: string,
  options: Pick<OmnipolymathStateDatabaseOptions, "path" | "env"> = {},
): Promise<ProjectRegistryRecord | undefined> {
  if (isWorkspaceProjectId(id)) {
    return resolveWorkspaceProject(cfg, id);
  }
  const context = captureOmnipolymathStateWorkerContext(options);
  return await readStoredProjectRegistry(context, id);
}

async function readStoredProjectRegistry(
  context: OmnipolymathStateWorkerContext,
  id: string,
): Promise<ProjectRegistryRecord | undefined> {
  const { executeOmnipolymathStateWorker } = await import("../state/omnipolymath-state-worker-store.js");
  return await executeOmnipolymathStateWorker(context, { type: "projects.resolve", input: { id } });
}

type ProjectRegistrySelection = {
  project: ProjectRegistryRecord;
  withCurrent: <T>(
    run: (current: {
      project: ProjectRegistryRecord | undefined;
      assertCurrent: () => void;
      assertCheckoutCurrent: () => void;
      signal: AbortSignal;
    }) => T | Promise<T>,
    acquisition?: { waitMs?: number },
  ) => Promise<T>;
  withRollback: <T>(run: (assertCurrent: () => void) => Promise<T>) => Promise<T>;
};

/** Retain the original database and reacquire the selected checkout for each finite operation. */
export async function selectStoredProjectRegistry(
  id: string,
  options: Pick<OmnipolymathStateDatabaseOptions, "path" | "env"> & { signal?: AbortSignal } = {},
): Promise<ProjectRegistrySelection | undefined> {
  const env = cloneEnvWithPlatformSemantics(options.env ?? process.env);
  const context = captureOmnipolymathStateWorkerContext({ path: options.path, env });
  const signal = options.signal;
  const project = await readStoredProjectRegistry(context, id);
  if (!project) {
    return undefined;
  }
  const repoRoot = project.repoRoot;
  return {
    project,
    withRollback: async (run) =>
      await withProjectCheckoutLifecycle(
        repoRoot,
        { path: context.admission.databasePath, env },
        async (lease) => {
          const { withOmnipolymathStateLeaseWorkerAdmission } =
            await import("../state/omnipolymath-state-lease-worker-owner.js");
          return await withOmnipolymathStateLeaseWorkerAdmission(
            lease,
            context.admission.databasePath,
            async (admission) =>
              await run(() => {
                context.admission.assertCurrent();
                admission.assertCurrent();
              }),
          );
        },
      ),
    withCurrent: async (run, acquisitionOptions) => {
      const acquisition = new AbortController();
      const abortAcquisition = () => acquisition.abort(signal?.reason);
      signal?.addEventListener("abort", abortAcquisition, { once: true });
      if (signal?.aborted) {
        abortAcquisition();
      }
      try {
        return await withProjectCheckoutLifecycle(
          repoRoot,
          {
            path: context.admission.databasePath,
            env,
            signal: acquisition.signal,
            waitMs: acquisitionOptions?.waitMs,
          },
          async (lease) => {
            // Cancellation stops new effects; checkout custody also owns their rollback.
            signal?.removeEventListener("abort", abortAcquisition);
            const operationSignal = signal ? AbortSignal.any([signal, lease.signal]) : lease.signal;
            try {
              const { withOmnipolymathStateLeaseWorkerAdmission } =
                await import("../state/omnipolymath-state-lease-worker-owner.js");
              const { runOmnipolymathStateWorkerOperation } =
                await import("../state/omnipolymath-state-worker-store.js");
              return await withOmnipolymathStateLeaseWorkerAdmission(
                lease,
                context.admission.databasePath,
                async (admission) => {
                  const assertCheckoutCurrent = () => {
                    context.admission.assertCurrent();
                    admission.assertCurrent();
                  };
                  const assertCurrent = () => {
                    assertCheckoutCurrent();
                    operationSignal.throwIfAborted();
                  };
                  return await runOmnipolymathStateWorkerOperation(
                    context,
                    async (scope) => {
                      const current = await scope.execute({
                        type: "projects.resolve",
                        input: { id },
                      });
                      assertCurrent();
                      return await run({
                        project: current,
                        assertCurrent,
                        assertCheckoutCurrent,
                        signal: operationSignal,
                      });
                    },
                    { assertCurrent, createAdmission: admission.createAdmission },
                  );
                },
              );
            } finally {
              // Resume cancellation while the native owner drains retained settlement and
              // selects unknown/lost/abort errors after this callback's cleanup has settled.
              signal?.addEventListener("abort", abortAcquisition, { once: true });
              if (signal?.aborted) {
                abortAcquisition();
              }
            }
          },
        );
      } finally {
        signal?.removeEventListener("abort", abortAcquisition);
      }
    },
  };
}

export async function resolveRecordedProjectRoot(
  projectPath: string,
  options: Pick<OmnipolymathStateDatabaseOptions, "path" | "env"> = {},
): Promise<string | undefined> {
  const context = captureOmnipolymathStateWorkerContext(options);
  const repoRoot = await fs.realpath(projectPath).catch(() => undefined);
  if (!repoRoot) {
    return undefined;
  }
  const { executeOmnipolymathStateWorker } = await import("../state/omnipolymath-state-worker-store.js");
  return await executeOmnipolymathStateWorker(context, {
    type: "projects.findRoot",
    input: { repoRoot },
  });
}

export async function removeProjectRegistry(
  project: ProjectRegistryRecord,
  options: Pick<OmnipolymathStateDatabaseOptions, "path" | "env"> = {},
): Promise<boolean> {
  const selectedProject: ProjectRegistryIdentity = {
    id: project.id,
    repoRoot: project.repoRoot,
    source: project.source,
    originUrl: project.originUrl,
  };
  const env = cloneEnvWithPlatformSemantics(options.env ?? process.env);
  const context = captureOmnipolymathStateWorkerContext({ path: options.path, env });
  return await withProjectCheckoutLifecycle(
    selectedProject.repoRoot,
    { path: context.admission.databasePath, env },
    async (lease) => {
      const { runWithOmnipolymathStateLeaseWorker } =
        await import("../state/omnipolymath-state-lease-worker-operation.js");
      return await runWithOmnipolymathStateLeaseWorker(lease, context, (scope, identity) =>
        scope.execute({
          type: "projects.remove",
          input: { project: selectedProject, lease: identity },
        }),
      );
    },
  );
}
