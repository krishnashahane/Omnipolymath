import { createSessionWorkerExecutionSource } from "../config/sessions/session-worker-execution-source.js";
import { readDatabasePathIdentitySync } from "../infra/sqlite-worker-identity.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { assertAgentSessionWriteAdmission } from "../sessions/session-agent-work-admission.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import * as creationClaims from "./agent-creation-claim.js";
import { isAgentDatabaseStartupReadReady } from "./agent-database-admission.js";
import {
  assertAgentDeletionCleanupAliases,
  assertAgentDeletionExecutionCleanupAccess,
  getAgentDeletionDatabaseCleanup,
} from "./agent-deletion-cleanup.js";
import type { OmnipolymathAgentDatabaseOptions } from "./omnipolymath-agent-db-contract.js";
import {
  isSameOmnipolymathAgentDatabasePath,
  resolveOmnipolymathAgentSqlitePath,
} from "./omnipolymath-agent-db.paths.js";
import type {
  OmnipolymathAgentDatabaseExecution,
  AgentDatabaseExecutionState,
} from "./omnipolymath-agent-execution-contract.js";
import { createAgentDatabaseExecution } from "./omnipolymath-agent-execution-owner.js";
import {
  assertAgentDatabaseExecutionCreationIdentity,
  assertAgentDatabaseExecutionSharedState,
  type AgentDatabaseExecutionCaptureConstraints,
  supportsOmnipolymathAgentDatabaseExecution,
} from "./omnipolymath-agent-execution-scope.js";
import { runOmnipolymathAgentWorkerWrite } from "./omnipolymath-agent-write-admission.js";

export { supportsOmnipolymathAgentDatabaseExecution } from "./omnipolymath-agent-execution-scope.js";

// References are derived; the canonical agent and shared resource owners govern retirement.
const executionState = resolveGlobalSingleton<AgentDatabaseExecutionState>(
  Symbol.for("omnipolymath.agentDatabaseExecutionOwners"),
  () => ({ owners: new Map(), idle: new Set() }),
);
const executions = executionState.owners;

/** Observe initial schema and registry publication through an already-captured physical path. */
export function getPendingOmnipolymathAgentDatabasePreparation(
  physicalPath: string,
  admission: "read" | "write" = "write",
): Promise<void> | undefined {
  const pending = executions.get(physicalPath)?.getPendingPreparation();
  return pending && admission === "read" && isAgentDatabaseStartupReadReady(physicalPath)
    ? undefined
    : pending;
}

/** Explicit preparation joins the file owner's already-captured creation target. */
export function captureOmnipolymathAgentDatabasePreparationExecution(
  options: OmnipolymathAgentDatabaseOptions,
  expectedIdentity?: AgentDatabaseExecutionCaptureConstraints["expectedIdentity"],
  requestedPath?: string,
): OmnipolymathAgentDatabaseExecution {
  return captureOmnipolymathAgentDatabaseExecution(options, { expectedIdentity, requestedPath }, true);
}

/** Only the deleted agent's store needs a fresh, exclusive cleanup owner. */
export async function captureAgentDeletionDatabaseExecution(
  options: OmnipolymathAgentDatabaseOptions,
): Promise<OmnipolymathAgentDatabaseExecution> {
  const cleanup = getAgentDeletionDatabaseCleanup(options);
  if (cleanup?.worker && cleanup.ownsDatabase) {
    cleanup.assertCurrentHost();
    const pathname = resolveOmnipolymathAgentSqlitePath(options);
    const previous =
      executions.get(pathname) ??
      executions.get(readDatabasePathIdentitySync(pathname).canonicalPath);
    if (previous) {
      assertAgentDatabaseExecutionSharedState(options, previous.sharedDatabaseKey);
      assertAgentDeletionExecutionCleanupAccess(previous, options);
      await previous.retireForCleanup();
      cleanup.assertCurrentHost();
    }
  }
  return captureOmnipolymathAgentDatabaseExecution(options);
}

/** Finish native initialization before publishing a newly available agent to readers. */
export async function prepareOmnipolymathAgentDatabaseExecution(
  options: OmnipolymathAgentDatabaseOptions,
  assertCurrent: () => void,
  signal?: AbortSignal,
): Promise<void> {
  assertCurrent();
  const execution = captureOmnipolymathAgentDatabaseExecution(options);
  try {
    await runOmnipolymathAgentWorkerWrite(
      options,
      () =>
        execution.prepare(
          createSessionWorkerExecutionSource(
            assertCurrent,
            `Agent ${options.agentId} database preparation admission expired`,
          ),
          signal,
        ),
      undefined,
      signal,
    );
  } finally {
    await execution.release();
  }
}

/** Borrow before callers yield; native opening stays lazy and release joins owned work. */
export function captureOmnipolymathAgentDatabaseExecution(
  options: OmnipolymathAgentDatabaseOptions,
  constraints: AgentDatabaseExecutionCaptureConstraints = {},
  inheritCreationIdentity = false,
): OmnipolymathAgentDatabaseExecution {
  assertAgentSessionWriteAdmission(options);
  assertAgentDeletionCleanupAliases(options, isSameOmnipolymathAgentDatabasePath);
  const agentId = normalizeAgentId(options.agentId);
  const pathname = resolveOmnipolymathAgentSqlitePath(options);
  creationClaims.assertAgentCreationClaimAliases(options);
  if (!supportsOmnipolymathAgentDatabaseExecution(options)) {
    throw new Error("This agent database scope still requires its existing native owner");
  }
  let existing = executions.get(pathname);
  const expectedCreationIdentity = constraints.expectedCreationIdentity
    ? Object.freeze({ ...constraints.expectedCreationIdentity })
    : undefined;
  if (!existing || expectedCreationIdentity) {
    const identity = readDatabasePathIdentitySync(pathname);
    existing ??= executions.get(identity.canonicalPath);
    if (expectedCreationIdentity) {
      assertAgentDatabaseExecutionCreationIdentity(
        pathname,
        expectedCreationIdentity,
        expectedCreationIdentity.key.startsWith("path:") && existing
          ? (existing.creationIdentity ?? identity)
          : identity,
        constraints.expectedIdentity,
      );
    }
    if (!existing) {
      return createAgentDatabaseExecution(
        options,
        {
          agentId,
          pathname,
          identity,
          initialIdentity: constraints.expectedIdentity,
          expectedCreationIdentity:
            expectedCreationIdentity ??
            (inheritCreationIdentity && identity.key.startsWith("path:") ? identity : undefined),
          requestedPath: constraints.requestedPath,
        },
        executionState,
      );
    }
  }
  if (existing.agentId !== agentId) {
    throw new Error(
      `Omnipolymath agent database ${pathname} is already open for agent ${existing.agentId}; requested agent ${agentId}.`,
    );
  }
  assertAgentDatabaseExecutionSharedState(options, existing.sharedDatabaseKey);
  assertAgentDeletionExecutionCleanupAccess(existing, options);
  return existing.borrow(
    pathname,
    constraints.expectedIdentity,
    expectedCreationIdentity ?? (inheritCreationIdentity ? existing.creationIdentity : undefined),
    constraints.requestedPath,
  );
}
