import type { SqliteWorkerAdmissionRequest } from "../infra/sqlite-worker-operation-admission.js";
import type { AgentDeletionCleanupWorkerAuthority } from "./agent-deletion-cleanup.types.js";
import type { AgentDeletionWorkerGuard } from "./agent-deletion-worker-contract.js";
import type { OmnipolymathStateAsyncLeaseContext } from "./omnipolymath-state-lease-context.js";
import type { withOmnipolymathStateLeaseAsync } from "./omnipolymath-state-lease.js";
import type { DomainScope } from "./omnipolymath-state-worker-store.types.js";

export type AgentDeletionWorkerAuthority = AgentDeletionCleanupWorkerAuthority & {
  withStateLease<T>(
    options: Parameters<typeof withOmnipolymathStateLeaseAsync>[0],
    run: (
      lease: OmnipolymathStateAsyncLeaseContext,
      assertCurrentHost: () => void,
      assertCurrentFinal: () => void,
    ) => Promise<T>,
  ): Promise<T>;
  runWithWorker<T>(
    operation: (scope: DomainScope, guard: AgentDeletionWorkerGuard) => Promise<T>,
    options?: {
      assertCurrent?: () => void;
      onCommitted?: (facts: unknown) => void;
      onAdmission?: (request: SqliteWorkerAdmissionRequest, stateIdentityKey: string) => void;
    },
  ): Promise<T>;
};
