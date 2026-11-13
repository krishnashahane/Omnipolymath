import { expect, vi } from "vitest";
import { createDeferredCore } from "../../shared/deferred.js";
import { runOmnipolymathStateWriteTransaction } from "../../state/omnipolymath-state-db.js";
import * as heartbeatOwner from "../../state/omnipolymath-state-lease-heartbeat.js";
import { releaseOmnipolymathStateLeaseInTransaction } from "../../state/omnipolymath-state-lease-store.js";
import { WORKTREE_MUTATION_LEASE_SCOPE } from "./capacity-contract.js";

/** Checkout custody outlives allocation; revoke the exact retained checkout owner. */
export function captureWorktreeMutationHeartbeat(): (worktreeId: string) => Promise<void> {
  const start = heartbeatOwner.startOmnipolymathStateLeaseHeartbeat;
  const heartbeats = new Map<
    string,
    {
      params: Parameters<typeof start>[0];
      heartbeat: ReturnType<typeof start>;
      lost: Promise<void>;
    }
  >();
  vi.spyOn(heartbeatOwner, "startOmnipolymathStateLeaseHeartbeat").mockImplementation((params) => {
    const lost = createDeferredCore();
    const heartbeat = start({
      ...params,
      onLost(error) {
        params.onLost(error);
        lost.resolve();
      },
    });
    if (params.identity.scope === WORKTREE_MUTATION_LEASE_SCOPE) {
      heartbeats.set(params.identity.key, { params, heartbeat, lost: lost.promise });
    }
    return heartbeat;
  });
  return async (worktreeId) => {
    const retained = heartbeats.get(worktreeId);
    if (!retained) {
      throw new Error(`Worktree mutation heartbeat is not live: ${worktreeId}`);
    }
    runOmnipolymathStateWriteTransaction(
      ({ db }) => releaseOmnipolymathStateLeaseInTransaction(db, retained.params.identity),
      { path: retained.params.path },
    );
    await expect(retained.heartbeat.verify()).rejects.toMatchObject({
      code: "OMNIPOLYMATH_STATE_LEASE_LOST",
    });
    await retained.lost;
  };
}
