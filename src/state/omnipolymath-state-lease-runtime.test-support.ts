import { createTestEntrypoint } from "../infra/runtime-entrypoint.test-support.ts";

const entrypoint = createTestEntrypoint(import.meta.url, "state");

// Compile once per test invocation so process-exit proof uses packaged worker startup.
export const stateLeaseProcessExitRuntimeEntrypoint = entrypoint(
  "omnipolymath-state-lease-process-exit-child.test-support",
);

export const stateLeaseRetentionRuntimeEntrypoint = entrypoint(
  "omnipolymath-state-lease.retention.test-support",
);

export const agentDatabaseHeldRuntimeEntrypoint = entrypoint(
  "omnipolymath-agent-db-held-child.test-support",
);

export const agentDeletionRecoveryHoldPostgresRuntimeEntrypoint = entrypoint(
  "agent-deletion-recovery-hold.postgres.test-support",
);

export const cronOwnerInspectionPostgresRuntimeEntrypoint = entrypoint(
  "cron-owner-inspection.postgres.test-support",
);

export const stateLeasePostgresRuntimeEntrypoint = entrypoint(
  "omnipolymath-state-lease.postgres.test-support",
);
