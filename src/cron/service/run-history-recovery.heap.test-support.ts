import assert from "node:assert/strict";
import { isRecord } from "@omnipolymath/normalization-core/record-coerce";
import { serveWorkerTasks } from "../../infra/worker-task-server.js";
import { withExistingOmnipolymathStateDatabaseReadOnly } from "../../state/omnipolymath-state-db-readonly.js";
import { findCronRunRecoveryInDatabase } from "./run-history-recovery.js";

// Recovers one run from a private state database inside a heap-limited worker.
serveWorkerTasks((input) => {
  assert.ok(isRecord(input));
  const { path, jobId, startedAt, storeKey, receiptId } = input;
  assert.ok(typeof path === "string" && typeof jobId === "string");
  assert.ok(typeof startedAt === "number" && typeof storeKey === "string");
  assert.ok(receiptId === undefined || typeof receiptId === "string");
  return withExistingOmnipolymathStateDatabaseReadOnly(
    ({ db }) =>
      findCronRunRecoveryInDatabase({ database: db, jobId, startedAt, storeKey, receiptId }),
    { path },
  );
});
