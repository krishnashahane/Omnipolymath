import { afterEach, beforeEach, expect, vi } from "vitest";
import type { OmnipolymathStateDatabaseAsyncResource } from "./omnipolymath-state-db-async-lifecycle.js";

const leaseMocks = vi.hoisted(() => ({
  registerResource: vi.fn<(resource: OmnipolymathStateDatabaseAsyncResource) => () => void>(),
  isWriteContention: vi.fn<(_error: unknown) => boolean>(() => false),
  forbidden: vi.fn(() => {
    throw new Error("Controlled lease test reached native storage, identity lookup, or transport");
  }),
}));
export { leaseMocks };
// mock-isolation: Track resource ownership without opening a native database cache.
vi.mock("./omnipolymath-state-db-cache.js", () => ({
  registerOmnipolymathStateDatabaseAsyncResource: leaseMocks.registerResource,
}));
// mock-isolation: Controlled lease tests must not register real process-exit handlers.
vi.mock("./omnipolymath-state-lease-process-exit.js", () => ({
  registerProcessExitLeaseCleanup: () => () => {},
}));
// mock-isolation: Native storage is forbidden; the fixture drives lease outcomes explicitly.
vi.mock("./omnipolymath-state-lease-storage.js", () => ({
  STATE_LEASE_WRITE_BACKOFF: { initialMs: 25, maxMs: 250, factor: 1.5, jitter: 0.25 },
  createOmnipolymathStateLeaseLostErrorFromDatabase: leaseMocks.forbidden,
  isOmnipolymathStateLeaseWriteContention: leaseMocks.isWriteContention,
  releaseOmnipolymathStateLeaseBestEffort: async (_params: unknown, execute?: () => Promise<void>) =>
    execute?.(),
  resolveLeaseDatabasePath: leaseMocks.forbidden,
  renewOmnipolymathStateLease: leaseMocks.forbidden,
  verifyOmnipolymathStateLeaseOwnership: leaseMocks.forbidden,
  releaseOmnipolymathStateLease: leaseMocks.forbidden,
}));
// mock-isolation: Reject unexpected native database reads from the controlled lease owner.
vi.mock("./omnipolymath-state-db-readonly.js", () => ({
  withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnly: leaseMocks.forbidden,
}));
vi.mock("../infra/sqlite-worker-identity.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../infra/sqlite-worker-identity.js")>()),
  inspectDatabasePathIdentitySync: leaseMocks.forbidden,
  readDatabasePathIdentitySync: leaseMocks.forbidden,
}));
beforeEach(() => {
  vi.clearAllMocks();
  leaseMocks.isWriteContention.mockReturnValue(false);
});
afterEach(() => expect(leaseMocks.forbidden).not.toHaveBeenCalled());
