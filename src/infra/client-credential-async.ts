import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { enqueueKeyedTask } from "../plugin-sdk/keyed-async-queue.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { registerOmnipolymathAgentDatabaseReadCandidateResource } from "../state/omnipolymath-agent-db-resources.js";
import { getOmnipolymathDatabaseMaintenanceScope } from "../state/omnipolymath-state-maintenance-context.js";
import {
  hydrateOmnipolymathStateWorkerError,
  retainOmnipolymathStateWorkerErrorPayload,
} from "../state/omnipolymath-state-worker-error.js";
import { requestClientCredentialsFromApp } from "./client-credential-ipc.js";
import { resolveClientCredentialStorePath } from "./client-credential-paths.js";
import type {
  ClientCredentialOperation,
  ClientCredentialResult,
} from "./client-credential-store.js";
import type {
  ClientCredentialPreparation,
  ClientCredentialWorkerInput,
  ClientCredentialWorkerOperation,
  ClientCredentialWorkerResult,
} from "./client-credential.worker.js";
import {
  acquireStateDatabaseSchemaLease,
  captureStateDatabaseAccess,
  type StateDatabaseSchemaLease,
} from "./gateway-state-owner.js";
import { resolveRuntimeProcessEntrypointUrl } from "./runtime-process-url.js";
import { retainSqliteWriteAdmissionService } from "./sqlite-transaction.js";
import { resolveDatabasePathKeyAsync } from "./sqlite-worker-identity.js";
import { createSqliteWorkerOperationAdmission } from "./sqlite-worker-operation-admission.js";
import { WorkerTaskPool } from "./worker-task-pool.js";

const queues = resolveGlobalSingleton(
  Symbol.for("omnipolymath.clientCredentialOperations"),
  () => new Map<string, Promise<void>>(),
);
type CredentialPool = WorkerTaskPool<ClientCredentialWorkerInput, ClientCredentialWorkerResult>;
const runtime = resolveGlobalSingleton(
  Symbol.for("omnipolymath.clientCredentialWorker"),
  (): {
    pool?: CredentialPool;
    closing?: Promise<void>;
    resources: Map<
      string,
      { access: Awaited<ReturnType<typeof captureStateDatabaseAccess>>; unregister: () => void }
    >;
  } => ({ resources: new Map() }),
  () => closeClientCredentialWorker(),
);

function closeClientCredentialWorker(): Promise<void> {
  runtime.closing ??= (async () => {
    await Promise.all(queues.values());
    await runtime.pool?.close();
    runtime.pool = undefined;
    for (const resource of runtime.resources.values()) {
      resource.unregister();
    }
    runtime.resources.clear();
  })().finally(() => {
    runtime.closing = undefined;
  });
  return runtime.closing;
}

/** Run one bounded off-thread operation, routing to the app when it owns this root. */
export async function runClientCredentialOperationAsync(
  env: NodeJS.ProcessEnv,
  operation: ClientCredentialOperation,
  options: { signal?: AbortSignal; assertCurrent?: () => void } = {},
): Promise<ClientCredentialResult> {
  return runClientCredentialTaskAsync(env, operation, options);
}

/** Reuse native admission's postimage without reading credentials on the caller thread. */
export async function prepareClientCredentialStoreAsync(
  env: NodeJS.ProcessEnv,
): Promise<ClientCredentialPreparation["state"]> {
  const result = await runClientCredentialTaskAsync(env, { kind: "startup.prepare" });
  return result.state;
}

function runClientCredentialTaskAsync(
  env: NodeJS.ProcessEnv,
  operation: ClientCredentialOperation,
  options?: { signal?: AbortSignal; assertCurrent?: () => void },
): Promise<ClientCredentialResult>;
function runClientCredentialTaskAsync(
  env: NodeJS.ProcessEnv,
  operation: { kind: "startup.prepare" },
): Promise<ClientCredentialPreparation>;
async function runClientCredentialTaskAsync(
  env: NodeJS.ProcessEnv,
  operation: ClientCredentialWorkerOperation,
  options: { signal?: AbortSignal; assertCurrent?: () => void } = {},
): Promise<ClientCredentialResult | ClientCredentialPreparation> {
  options.signal?.throwIfAborted();
  options.assertCurrent?.();
  // Resolve aliases in invocation order before reserving their shared canonical writer queue.
  const root = await enqueueKeyedTask({
    tails: queues,
    key: "\0credential-root-resolution",
    task: () => resolveDatabasePathKeyAsync(path.resolve(resolveStateDir(env))),
  });
  options.signal?.throwIfAborted();
  options.assertCurrent?.();
  const capturedEnv = {
    HOME: env.HOME,
    USERPROFILE: env.USERPROFILE,
    OMNIPOLYMATH_PROFILE: env.OMNIPOLYMATH_PROFILE,
    OMNIPOLYMATH_STATE_DIR: root,
  };
  const databasePath = resolveClientCredentialStorePath({ OMNIPOLYMATH_STATE_DIR: root });
  const assertCurrent = () => {
    options.signal?.throwIfAborted();
    options.assertCurrent?.();
  };
  assertCurrent();
  return enqueueKeyedTask({
    tails: queues,
    key: root,
    task: async () => {
      const offline = async () => {
        assertCurrent();
        if (runtime.closing) {
          throw new Error("Client credential worker is closing.");
        }
        let resource = runtime.resources.get(databasePath);
        if (!resource) {
          const access = await captureStateDatabaseAccess(databasePath);
          assertCurrent();
          if (runtime.closing) {
            throw new Error("Client credential worker is closing.");
          }
          resource = {
            access,
            unregister: registerOmnipolymathAgentDatabaseReadCandidateResource({
              path: databasePath,
              revoke() {
                void closeClientCredentialWorker().catch(() => {});
              },
              close: closeClientCredentialWorker,
            }),
          };
          runtime.resources.set(databasePath, resource);
        }
        const maintenance = getOmnipolymathDatabaseMaintenanceScope();
        const access = resource.access;
        const assertStateAccess = await access.prepareAccess({ maintenanceScope: maintenance });
        assertCurrent();
        let schemaLease: StateDatabaseSchemaLease | undefined;
        const assertAccess = () => {
          assertCurrent();
          maintenance?.assertAdmission();
          assertStateAccess({ maintenanceScope: maintenance, schemaLease });
        };
        const admission = createSqliteWorkerOperationAdmission((_request, grant) => {
          assertAccess();
          if (!grant()) {
            throw new Error("Client credential operation authority expired.");
          }
        });
        admission.bindDatabaseAuthority({
          databasePath,
          assertRequest: assertCurrent,
          assertAccess,
          acquireSchema() {
            assertAccess();
            const acquire = () => acquireStateDatabaseSchemaLease(databasePath);
            const lease = maintenance ? maintenance.run(acquire) : acquire();
            schemaLease = lease;
            maintenance?.own(lease, "shared-resources", () => lease.release());
            return lease;
          },
        });
        const releaseService = retainSqliteWriteAdmissionService([databasePath], () =>
          admission.service(),
        );
        try {
          runtime.pool ??= new WorkerTaskPool({
            workerUrl: resolveRuntimeProcessEntrypointUrl("clientCredentials"),
            workerClass: "singleton",
          });
          const result = await runtime.pool.run(
            { root, operation, admission: admission.port },
            {
              signal: options.signal,
              transferList: (input) => [input.admission],
            },
          );
          assertAccess();
          if (result.kind === "error") {
            const error = new Error("Client credential operation failed");
            retainOmnipolymathStateWorkerErrorPayload(error, result.error);
            throw hydrateOmnipolymathStateWorkerError(error, { includeOrdinary: true });
          }
          return result;
        } catch (error) {
          throw admission.failure ?? error;
        } finally {
          releaseService();
          admission.finish();
        }
      };
      const maintenance = getOmnipolymathDatabaseMaintenanceScope();
      if (maintenance?.ownsSchemaMaintenance) {
        maintenance.assertAdmission();
      } else {
        assertCurrent();
        const result = await requestClientCredentialsFromApp(
          capturedEnv,
          operation.kind === "startup.prepare"
            ? { kind: "identity.read", identity_key: "primary" }
            : operation,
          options.signal,
          assertCurrent,
        );
        assertCurrent();
        if (result) {
          return operation.kind === "startup.prepare"
            ? { kind: "preparation", state: "ready" }
            : result;
        }
      }
      // An uncertain app dispatch is terminal. Offline custody requires no app
      // request, a definite predispatch refusal, or held maintenance admission.
      const retried = await offline();
      if (retried.kind === "result") {
        return retried.result;
      }
      throw new Error("Client credentials are busy; retry after the current owner finishes.");
    },
  });
}
