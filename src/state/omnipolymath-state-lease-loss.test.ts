import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { createUpdateErrorFact } from "../infra/update-failure-facts.js";
import { updateRunFixture } from "../infra/update-run-fixture.test-support.js";
import { renderUpdateRunReport } from "../infra/update-run-report.js";
import type { DB } from "./omnipolymath-state-db.generated.js";
import {
  closeOmnipolymathStateDatabaseForTest,
  openOmnipolymathStateDatabase,
} from "./omnipolymath-state-db.js";
import {
  renewOmnipolymathStateLease,
  verifyOmnipolymathStateLeaseOwnership,
} from "./omnipolymath-state-lease-storage.js";
import { acquireOmnipolymathStateLeaseInTransaction } from "./omnipolymath-state-lease-store.js";
import {
  encodeOmnipolymathStateWorkerError,
  hydrateOmnipolymathStateWorkerError,
  retainOmnipolymathStateWorkerErrorPayload,
} from "./omnipolymath-state-worker-error.js";

const dirs = useAutoCleanupTempDirTracker(afterEach);
const now = 1_800_000_000_000;
const identity = { scope: "synthetic", key: "diagnostics", owner: "private-original-token" };
afterEach(() => {
  vi.restoreAllMocks();
  closeOmnipolymathStateDatabaseForTest();
});

it.each([
  { operation: "renew", reason: "expired" },
  { operation: "renew", reason: "replaced" },
  { operation: "renew", reason: "missing" },
  { operation: "verify", reason: "expired" },
  { operation: "verify", reason: "replaced" },
  { operation: "verify", reason: "missing" },
] as const)(
  "retains $reason loss through $operation and update history",
  ({ operation, reason }) => {
    const env = {
      HOME: dirs.make("lease-loss-"),
      OMNIPOLYMATH_STATE_DIR: dirs.make("lease-loss-state-"),
    };
    const options = { env };
    const { db } = openOmnipolymathStateDatabase(options);
    const sql = getNodeSqliteKysely<Pick<DB, "state_leases">>(db);
    const params = {
      ...identity,
      database: { scope: "shared" as const, options },
      operationLabel: "state.lease",
      leaseLabel: "state lease",
      leaseMs: 5_000,
    };
    vi.spyOn(Date, "now").mockReturnValue(now);
    acquireOmnipolymathStateLeaseInTransaction(db, identity, 5_000);
    if (reason === "missing") {
      executeSqliteQuerySync(db, sql.deleteFrom("state_leases"));
    } else {
      executeSqliteQuerySync(
        db,
        sql
          .updateTable("state_leases")
          .set(
            reason === "expired"
              ? { expires_at: now - 1_000, heartbeat_at: now - 6_000 }
              : { owner: "private-replacement-token" },
          ),
      );
    }
    let lost: unknown;
    try {
      if (operation === "renew") {
        renewOmnipolymathStateLease(params);
      } else {
        verifyOmnipolymathStateLeaseOwnership(params);
      }
    } catch (error) {
      lost = error;
    }
    const loss =
      reason === "expired"
        ? { reason, expiresAt: now - 1_000, expiredByMs: 1_000, heartbeatAgeMs: 6_000 }
        : reason === "replaced"
          ? { reason, owner: "[redacted]" }
          : { reason };
    expect(lost).toMatchObject({ code: "OMNIPOLYMATH_STATE_LEASE_LOST", loss });
    expect(lost).toHaveProperty("message", expect.stringContaining("retry the operation"));
    const transported = new Error("worker envelope");
    retainOmnipolymathStateWorkerErrorPayload(transported, encodeOmnipolymathStateWorkerError(lost));
    const hydrated = hydrateOmnipolymathStateWorkerError(transported);
    expect(hydrated).toMatchObject({ loss });
    expect(createUpdateErrorFact("plugin-finalization", hydrated, env).code).toBe(
      "OMNIPOLYMATH_STATE_LEASE_LOST",
    );
    const fact = createUpdateErrorFact(
      "plugin-finalization",
      new Error("x".repeat(400), { cause: hydrated }),
      env,
    );
    const run = updateRunFixture(options);
    run.step({ step: "plugin-finalization", status: "failed", failureFacts: [fact] });
    run.finish({ status: "failed", reason: "plugin-finalization-failed" });
    const record = run.read();
    expect(
      record?.steps.find((step) => step.step === "plugin-finalization")?.failureFacts?.[0],
    ).toMatchObject({ leaseLoss: loss });
    const report = renderUpdateRunReport(record!);
    expect(report.markdown).toContain(`lease loss: ${reason}`);
    expect(JSON.stringify({ record, report, lost, hydrated })).not.toContain(
      "private-original-token",
    );
    expect(JSON.stringify({ record, report, lost, hydrated })).not.toContain(
      "private-replacement-token",
    );
    executeSqliteQuerySync(db, sql.deleteFrom("state_leases"));
  },
);

it("preserves the generic loss when the diagnostic row cannot be read", () => {
  using db = openNodeSqliteDatabase(":memory:");
  db.exec("CREATE TABLE state_leases (scope TEXT, lease_key TEXT, owner TEXT, expires_at INTEGER)");
  expect(() =>
    verifyOmnipolymathStateLeaseOwnership({ ...identity, leaseLabel: "state lease", transaction: db }),
  ).toThrowError(
    expect.objectContaining({
      code: "OMNIPOLYMATH_STATE_LEASE_LOST",
      message: "state lease synthetic/diagnostics was lost; retry the operation",
    }),
  );
});
