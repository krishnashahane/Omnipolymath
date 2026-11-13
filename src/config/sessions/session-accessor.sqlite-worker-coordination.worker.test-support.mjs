import { once } from "node:events";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";

const { register } = await import(workerData.sourceLoaderUrl);
register();
const { runWithSqliteMutationWorkerCoordination } =
  await import("./session-accessor.sqlite-worker-coordination.ts");
const { acquireGatewayStateOwner } = await import("../../infra/gateway-state-owner.ts");
const { readGatewayLockProcessNamespace } = await import("../../infra/gateway-lock-payload.ts");
const { claimOmnipolymathAgentDatabaseLease, releaseOmnipolymathAgentDatabaseLease } =
  await import("../../state/omnipolymath-agent-db-lease.ts");
const { closeOmnipolymathStateDatabase } = await import("../../state/omnipolymath-state-db.ts");
const [coordination] = await once(parentPort, "message");
const execute = () =>
  runWithSqliteMutationWorkerCoordination(
    coordination,
    { agentId: workerData.operation, path: workerData.agentPath },
    async (options) => {
      if (workerData.operation === "hold") {
        const stateDir = coordination.stateContext.environment.OMNIPOLYMATH_STATE_DIR;
        const owner = acquireGatewayStateOwner({
          databasePath: coordination.databasePath,
          payload: {
            pid: process.pid,
            processNamespace: readGatewayLockProcessNamespace(),
            createdAt: new Date().toISOString(),
            configPath: path.join(stateDir, "omnipolymath.json"),
            stateDir,
            role: "gateway",
          },
        });
        try {
          parentPort.postMessage("held", []);
          const release = new Int32Array(workerData.release);
          Atomics.wait(release, 0, 0);
        } finally {
          owner.release();
        }
      } else if (workerData.operation === "cold-quarantine") {
        const { openOmnipolymathStateDatabase, runOmnipolymathStateWriteTransaction } =
          await import("../../state/omnipolymath-state-db.ts");
        const { readOmnipolymathDatabaseQuarantineFailure } =
          await import("../../state/omnipolymath-quarantine-store.ts");
        const database = openOmnipolymathStateDatabase({ env: options.env });
        runOmnipolymathStateWriteTransaction(
          () => {
            parentPort.postMessage("held", []);
            Atomics.wait(new Int32Array(workerData.release), 0, 0);
            const failure = readOmnipolymathDatabaseQuarantineFailure("agent", workerData.agentPath, {
              env: options.env,
            });
            if (failure) {
              throw failure;
            }
          },
          { database, env: options.env },
        );
        closeOmnipolymathStateDatabase();
        parentPort.postMessage("checked", []);
      } else {
        const lease = claimOmnipolymathAgentDatabaseLease(options);
        releaseOmnipolymathAgentDatabaseLease(lease, { env: options.env });
        closeOmnipolymathStateDatabase();
        parentPort.postMessage("claimed", []);
      }
    },
  );
if (coordination.fallbackAdmission) {
  const { withSqliteDatabaseAdmissionExchange } =
    await import("../../infra/sqlite-database-admission.ts");
  const { exchangeSqliteDatabaseAdmissions } =
    await import("../../infra/sqlite-worker-database-admission-relay.ts");
  await withSqliteDatabaseAdmissionExchange(
    (...args) => exchangeSqliteDatabaseAdmissions(coordination.fallbackAdmission, ...args),
    execute,
  );
  coordination.fallbackAdmission.close();
} else {
  await execute();
}
parentPort.close();
