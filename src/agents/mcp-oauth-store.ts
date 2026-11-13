// Canonical MCP OAuth session state. Legacy JSON import belongs to doctor only.
import type { SqliteWorkerCommand } from "../infra/sqlite-worker-contract.js";
import {
  createSqliteWorkerWriteAdmission,
  type SqliteWorkerStore,
} from "../infra/sqlite-worker-store.js";
import { executeExistingOmnipolymathStateRead } from "../state/omnipolymath-state-db-readonly.js";
import type { OmnipolymathStateAsyncLeaseContext } from "../state/omnipolymath-state-lease-context.js";
import { runWithOmnipolymathStateLeaseWorker } from "../state/omnipolymath-state-lease-worker-operation.js";
import {
  withOmnipolymathStateLeaseWorkerAdmission,
  type OmnipolymathStateLeaseWorkerAuthority,
} from "../state/omnipolymath-state-lease-worker-owner.js";
import type { OmnipolymathStateLeaseIdentity } from "../state/omnipolymath-state-lease.types.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import type { OmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.types.js";
import type { OmnipolymathStateWorkerOperations } from "../state/omnipolymath-state-worker-contract.js";
import {
  executeOmnipolymathStateWorker,
  runOmnipolymathStateWorkerOperation,
} from "../state/omnipolymath-state-worker-store.js";
import { isMcpOAuthAuthorizationReceipt } from "./mcp-oauth-authorization-facts.js";
import {
  projectMcpOAuthCredentialsStatus,
  type McpOAuthPrincipalStatus,
} from "./mcp-oauth-status.js";
import { retainMcpOAuthAuthorizationState } from "./mcp-oauth-store.authorization.js";
import type { McpOAuthReadOnlyOperations } from "./mcp-oauth-store.kernel.js";
import type { McpOAuthStore, McpOAuthMutation } from "./mcp-oauth-store.types.js";
export type { McpOAuthStore } from "./mcp-oauth-store.types.js";

export type McpOAuthStoreWriteOptions = {
  storeKey: string;
  lease: OmnipolymathStateAsyncLeaseContext;
  context: OmnipolymathStateWorkerContext;
};

function readExisting<Command extends SqliteWorkerCommand<McpOAuthReadOnlyOperations>>(
  context: OmnipolymathStateWorkerContext,
  command: Command,
) {
  return executeExistingOmnipolymathStateRead(
    { path: context.admission.databasePath, env: context.environment },
    command,
    { context },
  );
}

/** Read canonical state, opening the writable lifecycle when runtime owns it. */
export async function readMcpOAuthStore(
  storeKey: string,
  context: OmnipolymathStateWorkerContext = captureOmnipolymathStateWorkerContext(),
): Promise<McpOAuthStore> {
  return executeOmnipolymathStateWorker(context, { type: "mcpOAuth.read", input: storeKey });
}

/** Read status state without creating or repairing the shared database. */
export async function readMcpOAuthStoreReadOnly(
  storeKey: string,
  context: OmnipolymathStateWorkerContext = captureOmnipolymathStateWorkerContext(),
): Promise<McpOAuthStore> {
  const result = await readExisting(context, { type: "mcpOAuth.readOnly", input: storeKey });
  return result?.value ?? {};
}

export async function readMcpOAuthStoreStatuses(
  storeKeys: readonly string[],
  context: OmnipolymathStateWorkerContext = captureOmnipolymathStateWorkerContext(),
): Promise<McpOAuthPrincipalStatus[]> {
  if (storeKeys.length === 0) {
    return [];
  }
  const result = await readExisting(context, { type: "mcpOAuth.statuses", input: storeKeys });
  return result?.value ?? storeKeys.map(() => projectMcpOAuthCredentialsStatus({}));
}

/** List canonical store keys matching one server/principal prefix without creating state. */
export async function listMcpOAuthStoreKeysByPrefix(
  prefix: string,
  context: OmnipolymathStateWorkerContext = captureOmnipolymathStateWorkerContext(),
): Promise<string[]> {
  const result = await readExisting(context, { type: "mcpOAuth.keys", input: prefix });
  return result?.value ?? [];
}

export async function countMcpOAuthStorePrincipals(prefix: string): Promise<number> {
  const context = captureOmnipolymathStateWorkerContext();
  const result = await readExisting(context, { type: "mcpOAuth.countPrincipals", input: prefix });
  return result?.value ?? 0;
}

/** Resolve one unexpired callback state without creating state or scanning credential JSON. */
export async function readMcpOAuthPendingAuthorization(
  state: string,
  context: OmnipolymathStateWorkerContext = captureOmnipolymathStateWorkerContext(),
): Promise<string | undefined> {
  const result = await readExisting(context, { type: "mcpOAuth.pending", input: state });
  return result?.value;
}

/** Apply a bounded mutation under its original live store lease. */
export function mutateMcpOAuthStore(
  { storeKey, lease, context }: McpOAuthStoreWriteOptions,
  mutation: McpOAuthMutation,
  authority?: OmnipolymathStateLeaseWorkerAuthority,
): Promise<{ store: McpOAuthStore; applied: boolean }> {
  // Capture caller-owned values before worker opening can yield.
  const captured = structuredClone(mutation);
  return runMcpOAuthCredentialWrite(
    { storeKey, lease, context },
    (scope, identity) =>
      scope.execute(
        { type: "mcpOAuth.mutate", input: { storeKey, identity, mutation: captured } },
        { signal: lease.signal },
      ),
    authority,
  );
}

/** Claim one exact unexpired callback state while its store lease is still owned. */
export function consumeOAuthState(
  { storeKey, lease, context }: McpOAuthStoreWriteOptions,
  state: string,
  authority?: OmnipolymathStateLeaseWorkerAuthority,
): Promise<boolean> {
  return runWithOmnipolymathStateLeaseWorker(
    lease,
    context,
    (scope, identity) =>
      scope.execute(
        { type: "mcpOAuth.consumePending", input: { storeKey, identity, state } },
        { signal: lease.signal },
      ),
    authority,
  );
}

/** Replace one store's callback state after OAuth persisted its session. */
export function writeMcpOAuthPendingAuthorization(
  { storeKey, lease, context }: McpOAuthStoreWriteOptions,
  state: string,
  authority?: OmnipolymathStateLeaseWorkerAuthority,
): Promise<void> {
  return runWithOmnipolymathStateLeaseWorker(
    lease,
    context,
    (scope, identity) =>
      scope.execute(
        { type: "mcpOAuth.writePending", input: { storeKey, identity, state } },
        { signal: lease.signal },
      ),
    authority,
  );
}

/** Delete callback correlation for one settled or cleared OAuth store. */
export function deleteMcpOAuthPendingAuthorization(
  { storeKey, lease, context }: McpOAuthStoreWriteOptions,
  authority?: OmnipolymathStateLeaseWorkerAuthority,
): Promise<void> {
  return runWithOmnipolymathStateLeaseWorker(
    lease,
    context,
    (scope, identity) =>
      scope.execute(
        { type: "mcpOAuth.deletePending", input: { storeKey, identity } },
        { signal: lease.signal },
      ),
    authority,
  );
}

/** Clear one OAuth session while retaining explicit logout provenance. */
export function clearMcpOAuthStore(
  { storeKey, lease, context }: McpOAuthStoreWriteOptions,
  authority?: OmnipolymathStateLeaseWorkerAuthority,
): Promise<void> {
  return runMcpOAuthCredentialWrite(
    { storeKey, lease, context },
    (scope, identity) =>
      scope.execute(
        { type: "mcpOAuth.clear", input: { storeKey, identity } },
        { signal: lease.signal },
      ),
    authority,
  );
}

/** The lease owns admission; the credential owner fences and publishes its authorization fact. */
async function runMcpOAuthCredentialWrite<T>(
  { storeKey, lease, context }: McpOAuthStoreWriteOptions,
  operation: (
    scope: Pick<SqliteWorkerStore<OmnipolymathStateWorkerOperations>, "execute">,
    identity: OmnipolymathStateLeaseIdentity,
  ) => Promise<T>,
  authority?: OmnipolymathStateLeaseWorkerAuthority,
): Promise<T> {
  let owner: ReturnType<typeof retainMcpOAuthAuthorizationState> | undefined;
  let settle: ReturnType<ReturnType<typeof retainMcpOAuthAuthorizationState>["fence"]> | undefined;
  let publicationSettled: Promise<void> | undefined;
  const beforeCommit = authority?.beforeCommit;
  try {
    return await withOmnipolymathStateLeaseWorkerAdmission(
      lease,
      context.admission.databasePath,
      (leaseScope) =>
        runOmnipolymathStateWorkerOperation(context, (scope) => operation(scope, leaseScope.identity), {
          assertCurrent: leaseScope.assertCurrent,
          createAdmission(retained) {
            const binding = leaseScope.createAdmission(retained);
            publicationSettled = retained.settled.then((outcome) => {
              if (!settle) {
                return;
              }
              let known = false;
              try {
                const receipt = binding.admission.committed?.facts;
                if (
                  receipt !== undefined &&
                  (!isMcpOAuthAuthorizationReceipt(receipt) || receipt.storeKey !== storeKey)
                ) {
                  throw new Error("MCP OAuth mutation returned an invalid commit receipt");
                }
                known = outcome.kind !== "unknown";
                settle(known, receipt?.authorization);
              } finally {
                settle(known);
              }
            });
            void publicationSettled.catch(() => undefined);
            return binding;
          },
        }),
      {
        ...authority,
        assertCurrent: authority?.assertCurrent ?? (() => {}),
        beforeCommit() {
          beforeCommit?.();
          owner = retainMcpOAuthAuthorizationState(context.admission, storeKey);
          settle = owner.fence();
        },
      },
    );
  } finally {
    try {
      // Result delivery or caller revocation cannot reopen a still-pending native commit.
      await publicationSettled;
    } finally {
      owner?.release();
    }
  }
}

/** Remove orphan callback rows for a removed server's requester prefix. */
export function deleteMcpOAuthPendingAuthorizationsByPrefix(
  prefix: string,
  context: OmnipolymathStateWorkerContext = captureOmnipolymathStateWorkerContext(),
): Promise<void> {
  return runOmnipolymathStateWorkerOperation(
    context,
    (scope) => scope.execute({ type: "mcpOAuth.clearPendingPrefix", input: prefix }),
    {
      assertCurrent: context.admission.assertCurrent,
      createAdmission: createSqliteWorkerWriteAdmission(context.admission.assertCurrent, [
        context.admission.databasePath,
      ]),
    },
  );
}
