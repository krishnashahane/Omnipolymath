import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { expectDefined } from "@omnipolymath/normalization-core/expect";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  mergeWorkspaceSetupState,
  readWorkspaceStateSnapshot,
  replaceWorkspaceAttestation,
} from "../agents/workspace-state-store.js";
import { withExistingOmnipolymathStateSchema } from "../state/omnipolymath-state-db-schema-policy.js";
import {
  closeOmnipolymathStateDatabaseAsync,
  openOmnipolymathStateDatabase,
} from "../state/omnipolymath-state-db.js";
import type { OmnipolymathStateWorkerLeaseContext } from "../state/omnipolymath-state-lease-context.js";
import { runWithOmnipolymathStateLeasesWorker } from "../state/omnipolymath-state-lease-worker-operation.js";
import { withOmnipolymathStateLeaseAsync } from "../state/omnipolymath-state-lease.js";
import type { OmnipolymathStateLeaseIdentity } from "../state/omnipolymath-state-lease.types.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import type { OmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.types.js";
import {
  mergeWorkspaceBootstrapSetupStateForAdd,
  rollbackWorkspaceBootstrapSeedForAdd,
} from "./add-state-write.js";

const dirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    await closeOmnipolymathStateDatabaseAsync();
    cleanup();
  }),
);
afterEach(() => vi.unstubAllEnvs());
const bootstrapSeededAt = "2026-10-28T03:00:00.000Z";
const nowMs = Date.parse(bootstrapSeededAt);
const bootstrapSha256 = "a".repeat(64);

type Fixture = {
  workspaceDir: string;
  context: OmnipolymathStateWorkerContext;
  leases: readonly OmnipolymathStateWorkerLeaseContext[];
  read: () => ReturnType<typeof readWorkspaceStateSnapshot>;
};

async function withAddLeases(run: (fixture: Fixture) => Promise<void>) {
  const root = dirs.make("template-bootstrap-worker-");
  const workspaceDir = path.join(root, "workspace");
  await mkdir(workspaceDir);
  const env = {
    ...process.env,
    OMNIPOLYMATH_STATE_DIR: path.join(root, "state"),
    OMNIPOLYMATH_CONFIG_PATH: path.join(root, "omnipolymath.json"),
  };
  vi.stubEnv("OMNIPOLYMATH_STATE_DIR", env.OMNIPOLYMATH_STATE_DIR);
  vi.stubEnv("OMNIPOLYMATH_CONFIG_PATH", env.OMNIPOLYMATH_CONFIG_PATH);
  const database = openOmnipolymathStateDatabase({ env });
  await withExistingOmnipolymathStateSchema({ path: database.path }, async () => {
    const context = captureOmnipolymathStateWorkerContext({ env });
    await withOmnipolymathStateLeaseAsync(
      {
        scope: "core:template-add-allocation",
        key: "bootstrap-worker",
        leaseMs: 60_000,
        waitMs: 0,
        heartbeat: "worker",
      },
      context,
      async (allocation) =>
        withOmnipolymathStateLeaseAsync(
          {
            scope: "core:agent-deletion",
            key: "bootstrap-worker",
            leaseMs: 60_000,
            waitMs: 0,
            heartbeat: "worker",
          },
          context,
          async (agent) => {
            await Promise.all([allocation.assertOwned(), agent.assertOwned()]);
            await run({
              workspaceDir,
              context,
              leases: [allocation, agent],
              read: () => readWorkspaceStateSnapshot(workspaceDir, { env, readOnly: true }),
            });
          },
        ),
    );
  });
}

it("persists bootstrap setup through the real worker under both live Add leases", async () => {
  await withAddLeases(async (fixture) => {
    await expect(
      mergeWorkspaceBootstrapSetupStateForAdd(
        fixture.workspaceDir,
        bootstrapSeededAt,
        bootstrapSha256,
        nowMs,
        { stateMode: "worker", leaseSet: fixture },
      ),
    ).resolves.toEqual({ version: 1, bootstrapSeededAt });
    expect(await fixture.read()).toMatchObject({
      setupExists: true,
      setup: { version: 1, bootstrapSeededAt },
      attestation: { generatedHashes: new Map([["BOOTSTRAP.md", bootstrapSha256]]) },
    });
  });
});

it.each(["owned", "different", "completed"] as const)(
  "rolls back only the owned seed while preserving workspace attestation (%s)",
  async (mode) => {
    await withAddLeases(async (fixture) => {
      const options = { stateMode: "worker" as const, leaseSet: fixture };
      await mergeWorkspaceBootstrapSetupStateForAdd(
        fixture.workspaceDir,
        bootstrapSeededAt,
        bootstrapSha256,
        nowMs,
        options,
      );
      await replaceWorkspaceAttestation({
        workspaceDir: fixture.workspaceDir,
        attestedAtMs: nowMs,
        generatedHashes: new Map(),
        nowMs,
      });
      if (mode === "completed") {
        await mergeWorkspaceSetupState(
          fixture.workspaceDir,
          { setupCompletedAt: bootstrapSeededAt },
          nowMs,
        );
      }
      await rm(fixture.workspaceDir, { recursive: true });
      await rollbackWorkspaceBootstrapSeedForAdd(
        fixture.workspaceDir,
        mode === "different" ? new Date(nowMs - 1).toISOString() : bootstrapSeededAt,
        options,
      );
      const snapshot = await fixture.read();
      expect(snapshot.attestation).toEqual({ attestedAtMs: nowMs, generatedHashes: new Map() });
      expect(snapshot.setup).toEqual({
        version: 1,
        ...(mode !== "owned" ? { bootstrapSeededAt } : {}),
        ...(mode === "completed" ? { setupCompletedAt: bootstrapSeededAt } : {}),
      });
    });
  },
);

it.each(["missing", "mismatched", "duplicate", "stale"] as const)(
  "refuses %s lease facts without publishing bootstrap setup",
  async (mode) => {
    await withAddLeases(async (fixture) => {
      const mutation = runWithOmnipolymathStateLeasesWorker(
        fixture.leases,
        fixture.context,
        (scope, identities) => {
          const first = expectDefined(identities[0], "allocation identity");
          const second = expectDefined(identities[1], "agent identity");
          const leases: readonly OmnipolymathStateLeaseIdentity[] | undefined =
            mode === "missing"
              ? undefined
              : mode === "mismatched"
                ? [second, first]
                : mode === "duplicate"
                  ? [first, first]
                  : [{ ...first, owner: "retired-owner" }, second];
          return scope.execute({
            type: "templates.add.mergeBootstrapSetupState",
            input: {
              workspaceDir: fixture.workspaceDir,
              bootstrapSeededAt,
              bootstrapSha256,
              nowMs,
              ...(leases ? { leases } : {}),
            },
          });
        },
      );
      if (mode === "duplicate") {
        await expect(mutation).rejects.toThrow("distinct live leases");
      } else {
        await expect(mutation).rejects.toMatchObject({ code: "OMNIPOLYMATH_STATE_LEASE_LOST" });
      }
      const snapshot = await fixture.read();
      expect(snapshot).toMatchObject({ setupExists: false });
      expect(snapshot.attestation).toBeUndefined();
    });
  },
);

it.each(["seed", "rollback"] as const)(
  "refuses %s when the original caller is revoked at native commit",
  async (mode) => {
    await withAddLeases(async (fixture) => {
      if (mode === "rollback") {
        await mergeWorkspaceBootstrapSetupStateForAdd(
          fixture.workspaceDir,
          bootstrapSeededAt,
          bootstrapSha256,
          nowMs,
          {
            stateMode: "worker",
            leaseSet: fixture,
          },
        );
      }
      let current = true;
      const revoked = new Error("Template Add authority retired before commit");
      await expect(
        runWithOmnipolymathStateLeasesWorker(
          fixture.leases,
          fixture.context,
          (scope, leases) =>
            scope.execute(
              mode === "seed"
                ? {
                    type: "templates.add.mergeBootstrapSetupState",
                    input: {
                      workspaceDir: fixture.workspaceDir,
                      bootstrapSeededAt,
                      bootstrapSha256,
                      nowMs,
                      leases,
                    },
                  }
                : {
                    type: "templates.add.rollbackBootstrapSeed",
                    input: { workspaceDir: fixture.workspaceDir, bootstrapSeededAt, leases },
                  },
            ),
          {
            assertCurrent: () => {
              if (!current) {
                throw revoked;
              }
            },
            beforeCommit: () => {
              current = false;
            },
          },
        ),
      ).rejects.toThrow(revoked.message);
      expect(current).toBe(false);
      if (mode === "seed") {
        expect((await fixture.read()).attestation).toBeUndefined();
      }
      expect(await fixture.read()).toMatchObject(
        mode === "seed" ? { setupExists: false } : { setup: { version: 1, bootstrapSeededAt } },
      );
    });
  },
);
