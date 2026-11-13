import { setImmediate as yieldImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { createDeferredCore } from "../shared/deferred.js";
import { withOmnipolymathStateLeaseAsync } from "./omnipolymath-state-lease.js";
import type { OmnipolymathStateWorkerContext } from "./omnipolymath-state-worker-context.types.js";

const queued = vi.hoisted(() => ({
  execute: vi.fn<(_command: unknown, options?: { signal?: AbortSignal }) => Promise<never>>(),
}));
vi.mock("./omnipolymath-state-worker-store.js", () => ({
  // Model a command waiting in the broker queue, before native dispatch and settlement custody.
  runOmnipolymathStateWorkerOperation: async (
    _context: unknown,
    operation: (scope: { execute: typeof queued.execute }) => Promise<unknown>,
  ) => operation({ execute: queued.execute }),
}));
vi.mock("./omnipolymath-state-db-cache.js", () => ({
  registerOmnipolymathStateDatabaseAsyncResource: () => () => {},
}));

it("settles an aborted acquisition without waiting for an unrelated queued command", async () => {
  const entered = createDeferredCore();
  const pending = createDeferredCore<never>();
  queued.execute.mockImplementation((_command, options) => {
    const reject = () => pending.reject(options?.signal?.reason);
    if (options?.signal?.aborted) {
      reject();
    } else {
      options?.signal?.addEventListener("abort", reject, { once: true });
    }
    entered.resolve();
    return pending.promise;
  });
  const context: OmnipolymathStateWorkerContext = {
    environment: { OMNIPOLYMATH_STATE_DIR: "/synthetic-lease" },
    admission: {
      coordinationKey: "file:synthetic-lease",
      databasePath: "/synthetic-lease/state.sqlite",
      identity: { key: "file:synthetic-lease", canonicalPath: "/synthetic-lease/state.sqlite" },
      assertCurrent() {},
    },
  };
  const controller = new AbortController();
  const callback = vi.fn(async () => {});
  let settled = false;
  const outcome = withOmnipolymathStateLeaseAsync(
    { scope: "core:test", key: "queued", leaseMs: 30_000, waitMs: 0, signal: controller.signal },
    context,
    callback,
  ).then(
    () => {
      settled = true;
      return undefined;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  try {
    await entered.promise;
    const reason = new Error("caller canceled while queued");
    controller.abort(reason);
    await yieldImmediate();
    expect(settled).toBe(true);
    expect(await outcome).toMatchObject({
      code: "OMNIPOLYMATH_STATE_LEASE_ABORTED",
      outcome: { kind: "aborted", reason: "caller-signal" },
      cause: reason,
    });
    expect(callback).not.toHaveBeenCalled();
  } finally {
    pending.reject(new Error("Synthetic queue disposed"));
    await outcome;
  }
});
