import type { StatsFs } from "node:fs";
import { vi } from "vitest";
import * as workerAdmission from "../../infra/sqlite-worker-operation-admission.js";
import {
  openOmnipolymathStateDatabase,
  runOmnipolymathStateWriteTransaction,
} from "../../state/omnipolymath-state-db.js";
import { releaseOmnipolymathStateLeaseInTransaction } from "../../state/omnipolymath-state-lease-store.js";
import { withOmnipolymathStateLeasesWorkerAdmission } from "../../state/omnipolymath-state-lease-worker-owner.js";
import { WORKTREE_CAPACITY_RESERVATION_SCOPE } from "./capacity-contract.js";
import * as transport from "./capacity-store.js";
import { reserveWorktreeCapacityInWorker } from "./capacity.worker.js";

export function createWorktreeCapacityStatfs(stats: StatsFs, availableBytes: number): StatsFs {
  return {
    type: stats.type,
    files: stats.files,
    frsize: stats.frsize,
    ffree: stats.ffree,
    bsize: 4096,
    blocks: 1024 ** 4 / 4096,
    bavail: availableBytes / 4096,
    bfree: availableBytes / 4096,
  };
}

/** Synthetic filesystem quotas use the real admission kernel in the fixture's process. */
export function useInProcessWorktreeCapacityTransport() {
  vi.spyOn(transport, "reserveWorktreeCapacity").mockImplementation(async (params) =>
    withOmnipolymathStateLeasesWorkerAdmission(
      params.leaseSet.leases,
      params.leaseSet.context,
      async (authority) => {
        params.assertCurrent();
        const options = {
          path: params.leaseSet.context.admission.databasePath,
          env: params.leaseSet.context.environment,
        };
        const database = openOmnipolymathStateDatabase(options);
        const admission = vi
          .spyOn(workerAdmission, "requestSqliteWorkerOperationAdmission")
          .mockImplementation(() => {
            params.leaseSet.context.admission.assertCurrent();
            params.assertCurrent();
            authority.assertCurrent();
          });
        try {
          return reserveWorktreeCapacityInWorker(
            { ...params.request, leases: authority.identities, predicates: params.predicates },
            { open: () => database, stateOptions: () => options },
          );
        } finally {
          admission.mockRestore();
        }
      },
    ),
  );
  vi.spyOn(transport, "releaseWorktreeCapacity").mockImplementation(async (params) =>
    runOmnipolymathStateWriteTransaction(
      ({ db }) => {
        params.assertCurrent();
        releaseOmnipolymathStateLeaseInTransaction(db, {
          scope: WORKTREE_CAPACITY_RESERVATION_SCOPE,
          key: params.key,
          owner: params.key,
        });
        params.assertCurrent();
      },
      { path: params.context.admission.databasePath, env: params.context.environment },
    ),
  );
}
