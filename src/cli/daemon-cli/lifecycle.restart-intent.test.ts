import { hostname } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { resolveConfigPath } from "../../config/paths.js";
import { withGatewayServiceUpdateAuthority } from "../../daemon/service-update-authority.js";
import { readGatewayLockProcessNamespace } from "../../infra/gateway-lock-payload.js";
import { acquireGatewayOwnerLease } from "../../infra/gateway-owner-lease.js";
import type { GatewayOwnerSupervisor } from "../../infra/gateway-owner-lease.types.js";
import {
  acquireGatewayStateOwner,
  tryAcquireGatewayStateOwner,
} from "../../infra/gateway-state-owner.js";
import {
  prepareGatewayRestartIntentConsumption,
  type GatewayRestartIntent,
} from "../../infra/restart-intent.js";
import * as snapshotWorker from "../../infra/sqlite-readonly-worker.js";
import * as processOwners from "../../infra/state-lease-process-owner.js";
import {
  closeOmnipolymathStateDatabaseForTest,
  closeOmnipolymathStateDatabaseAsync,
  openOmnipolymathStateDatabase,
} from "../../state/omnipolymath-state-db.js";
import { resolveOmnipolymathStateSqlitePath } from "../../state/omnipolymath-state-db.paths.js";
import { beforeIntentWriteAdmission } from "./lifecycle.restart-intent.test-support.js";
import {
  createGatewayServiceRunArgs,
  lifecycleTestRuntime,
  lifecycleRuntimeLogs,
  resetLifecycleRuntimeLogs,
  resetLifecycleServiceMocks,
  service,
} from "./test-helpers/lifecycle-core-harness.js";

vi.mock("../../runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../runtime.js")>()),
  defaultRuntime: lifecycleTestRuntime,
}));
vi.mock("./lifecycle-action-preflight.js", () => ({
  getServiceActionPreflightFailure: async () => null,
}));
vi.mock("./lifecycle-audit.js", () => ({
  createServiceLifecycleMutationAudit: () => undefined,
  appendServiceLifecycleRepairAudit: vi.fn(),
}));

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const { runServiceRestart } = await import("./lifecycle-core.js");

function readIntent() {
  return openOmnipolymathStateDatabase()
    .db.prepare("SELECT pid, reason FROM gateway_restart_intent")
    .get();
}

function expectNoRestart() {
  expect(service.restart).not.toHaveBeenCalled();
  expect(readIntent()).toBeUndefined();
}

async function expectRestartRefused(message?: string, json = true) {
  await expect(
    runServiceRestart({ ...createGatewayServiceRunArgs(), opts: { json } }),
  ).rejects.toThrow("__exit__:1");
  expectNoRestart();
  if (message) {
    expect(
      [...lifecycleRuntimeLogs, ...lifecycleTestRuntime.error.mock.calls.flat()].join("\n"),
    ).toContain(message);
  }
}

function acquireServingStateOwner(env: NodeJS.ProcessEnv = process.env) {
  return acquireGatewayStateOwner({
    databasePath: resolveOmnipolymathStateSqlitePath(env),
    payload: {
      pid: process.pid,
      processNamespace: readGatewayLockProcessNamespace(),
      createdAt: new Date().toISOString(),
      configPath: resolveConfigPath(env),
      role: "gateway",
    },
  });
}

function publishServingOwner(
  pid: number,
  mode: "supervised" | "foreground" = "supervised",
  supervisor: GatewayOwnerSupervisor | null = {
    kind: "systemd",
    name: "omnipolymath-gateway.service",
  },
  host = hostname(),
) {
  const { db } = openOmnipolymathStateDatabase();
  const now = Date.now();
  db.prepare(
    `INSERT INTO state_leases
     (scope, lease_key, owner, expires_at, heartbeat_at, payload_json, created_at, updated_at)
     VALUES ('gateway-owner', 'global', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope, lease_key) DO UPDATE SET
       owner = excluded.owner, payload_json = excluded.payload_json`,
  ).run(
    `generation-${pid}`,
    now + 60_000,
    now,
    JSON.stringify({
      owner: {
        pid,
        host,
        startedAt: 1,
        processNamespace: { ...readGatewayLockProcessNamespace(), host },
      },
      port: 18789,
      mode,
      supervisor,
    }),
    now,
    now,
  );
}

beforeEach(() => {
  resetLifecycleRuntimeLogs();
  lifecycleTestRuntime.error.mockClear();
  resetLifecycleServiceMocks();
  const environment = { OMNIPOLYMATH_STATE_DIR: tempDirs.make("omnipolymath-restart-intent-cli-") };
  vi.stubEnv("OMNIPOLYMATH_STATE_DIR", environment.OMNIPOLYMATH_STATE_DIR);
  service.readCommand.mockResolvedValue({ programArguments: [], environment });
  vi.stubEnv("OMNIPOLYMATH_PROFILE", "default");
  vi.stubEnv("OMNIPOLYMATH_SYSTEMD_UNIT", "");
  vi.stubEnv("OMNIPOLYMATH_LAUNCHD_LABEL", "");
  service.readRuntime.mockResolvedValue({ status: "running", pid: process.pid + 1 });
});

afterEach(async () => {
  await closeOmnipolymathStateDatabaseAsync();
  closeOmnipolymathStateDatabaseForTest();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it.each([
  { platform: "linux", supervisor: { kind: "systemd", name: "omnipolymath-gateway" } },
  { platform: "darwin", supervisor: { kind: "launchd", name: "ai.omnipolymath.gateway" } },
] as const)(
  "delivers the managed $platform/$supervisor.name restart intent to the serving owner in its service state",
  async ({ platform, supervisor }) => {
    const nativePlatform = process.platform;
    const stateDir = tempDirs.make("omnipolymath-serving-state-");
    const env = { ...process.env, OMNIPOLYMATH_STATE_DIR: stateDir };
    const coordinator = acquireServingStateOwner(env);
    const lease = acquireGatewayOwnerLease({
      env,
      port: 18789,
      mode: "supervised",
      supervisor,
    });
    try {
      await lease.ready;
      const servicePlatform = vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      const readOwnerStatus = processOwners.readStateLeaseProcessOwnerStatus;
      // Service selection is synthetic; the real lease still belongs to this host.
      vi.spyOn(processOwners, "readStateLeaseProcessOwnerStatus").mockImplementation((...args) => {
        servicePlatform.mockReturnValue(nativePlatform);
        try {
          return readOwnerStatus(...args);
        } finally {
          servicePlatform.mockReturnValue(platform);
        }
      });
      service.readRuntime.mockResolvedValue({
        status: "running",
        pid: process.pid + 1,
        ...(platform === "linux" ? { systemd: { unit: "omnipolymath-gateway.service" } } : {}),
      });
      service.readCommand.mockResolvedValue({
        programArguments: ["node", "omnipolymath.mjs", "gateway", "run"],
        environment: { OMNIPOLYMATH_STATE_DIR: stateDir },
      });
      let consumed: GatewayRestartIntent | null = null;
      service.restart.mockImplementationOnce(async (args) => {
        await args.prepareRestart?.();
        consumed = await prepareGatewayRestartIntentConsumption(env)();
        return { outcome: "completed" };
      });

      await expect(
        runServiceRestart({
          ...createGatewayServiceRunArgs(),
          opts: { json: true, preserveDefinition: true, restartIntent: { waitMs: 30_000 } },
        }),
      ).resolves.toBe(true);

      expect(consumed).toEqual({ reason: "gateway.restart", waitMs: 30_000 });
      expect(await prepareGatewayRestartIntentConsumption(env)()).toBeNull();
    } finally {
      await lease.release();
      coordinator.release();
    }
  },
);

it("targets the replacement at write admission despite stopped native status", async () => {
  service.readRuntime.mockResolvedValue({ status: "stopped" });
  const coordinator = acquireServingStateOwner();
  vi.spyOn(process, "platform", "get").mockReturnValue("linux");
  // Synthetic process identities isolate the race; lease storage and intent consumption are real.
  vi.spyOn(processOwners, "readStateLeaseProcessOwnerStatus").mockReturnValue("live");
  try {
    publishServingOwner(process.pid + 2);
    let publications = 0;
    beforeIntentWriteAdmission(() => {
      publishServingOwner(process.pid);
      publications += 1;
    });
    let consumed: GatewayRestartIntent | null = null;
    service.restart.mockImplementationOnce(async () => {
      consumed = await prepareGatewayRestartIntentConsumption()();
      return { outcome: "completed" };
    });

    await expect(runServiceRestart(createGatewayServiceRunArgs())).resolves.toBe(true);

    expect(publications).toBe(1);
    expect(consumed).toEqual({ reason: "gateway.restart" });
  } finally {
    coordinator.release();
  }
});

it.each([
  { state: "hostname-drift", mode: "supervised", name: "omnipolymath-gateway.service" },
  { state: "unknown", mode: "supervised", name: "omnipolymath-gateway.service" },
  { state: "live", mode: "foreground", name: "omnipolymath-gateway.service" },
  { state: "live", mode: "supervised", name: "another-gateway.service" },
  { state: "live", mode: "supervised", name: null },
] as const)(
  "refuses restart for an unrelated or unverifiable serving owner ($state/$mode/$name)",
  async ({ state, mode, name }) => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    if (state !== "hostname-drift") {
      vi.spyOn(processOwners, "readStateLeaseProcessOwnerStatus").mockReturnValue(state);
    }
    openOmnipolymathStateDatabase();
    const coordinator = acquireServingStateOwner();
    try {
      publishServingOwner(
        process.pid + 2,
        mode,
        mode === "supervised" ? { kind: "systemd", name } : null,
        state === "hostname-drift" ? "previous-hostname" : hostname(),
      );
      service.readRuntime.mockResolvedValue({ status: "running", pid: process.pid });

      await expectRestartRefused("live serving Gateway owner", state !== "hostname-drift");
      if (state === "hostname-drift") {
        const output = lifecycleTestRuntime.error.mock.calls.flat().join("\n");
        expect(output).toContain(
          `Recorded serving host "previous-hostname" does not match this host ${JSON.stringify(hostname())}`,
        );
        expect(output).toContain("Gateway was not signaled");
      }
    } finally {
      coordinator.release();
    }
  },
);

it.each(["command inspection", "missing command", "intent recording"])(
  "refuses native restart after failed %s",
  async (failure) => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    openOmnipolymathStateDatabase();
    if (failure === "command inspection") {
      publishServingOwner(process.pid);
      vi.spyOn(processOwners, "readStateLeaseProcessOwnerStatus").mockReturnValue("live");
      service.readCommand.mockRejectedValue(new Error("native command inspection unavailable"));
    } else if (failure === "missing command") {
      service.readCommand.mockResolvedValue(null);
    } else {
      beforeIntentWriteAdmission(() => {
        throw new Error("write admission unavailable");
      });
    }
    await expectRestartRefused(
      failure === "intent recording" ? "Cannot record restart intent" : "effective service command",
      failure !== "command inspection",
    );
    if (failure === "command inspection") {
      const output = [
        ...lifecycleRuntimeLogs,
        ...lifecycleTestRuntime.error.mock.calls.flat(),
      ].join("\n");
      expect(output).toContain("GATEWAY_RESTART_PREPARATION_REFUSED");
      expect(output).toContain("Gateway was not signaled");
    }
  },
);

it.each([false, true])(
  "admits stopped-service startup only without an active owner (active=%s)",
  async (active) => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    const { db } = openOmnipolymathStateDatabase();
    const coordinator = active
      ? acquireGatewayStateOwner({ databasePath: resolveOmnipolymathStateSqlitePath(process.env) })
      : undefined;
    if (!active) {
      closeOmnipolymathStateDatabaseForTest();
    }
    service.readRuntime.mockResolvedValue({ status: "stopped" });
    service.restart.mockImplementationOnce(async () => {
      const exclusion = tryAcquireGatewayStateOwner(resolveOmnipolymathStateSqlitePath(process.env));
      expect(exclusion).not.toBeNull();
      exclusion?.release();
      return { outcome: "completed" };
    });
    const synchronousSnapshot = active
      ? undefined
      : vi.spyOn(snapshotWorker, "runSqliteReadOnlyWorkerSync").mockImplementation(() => {
          throw new Error("Stopped-service intent admission must not synchronously copy state");
        });

    try {
      if (active) {
        await expect(runServiceRestart(createGatewayServiceRunArgs())).rejects.toThrow(
          "__exit__:1",
        );
        expect(service.restart).not.toHaveBeenCalled();
        expect(db.prepare("SELECT count(*) AS count FROM gateway_restart_intent").get()).toEqual({
          count: 0,
        });
      } else {
        await expect(runServiceRestart(createGatewayServiceRunArgs())).resolves.toBe(true);
        expect(synchronousSnapshot).not.toHaveBeenCalled();
        synchronousSnapshot?.mockRestore();
        expect(service.restart).toHaveBeenCalledOnce();
        expect(readIntent()).toBeUndefined();
      }
    } finally {
      synchronousSnapshot?.mockRestore();
      coordinator?.release();
    }
  },
);

it.each(["runtime", "command", "write admission"])(
  "revalidates update authority after native %s inspection before recording intent",
  async (inspection) => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    openOmnipolymathStateDatabase();
    let current = true;
    if (inspection === "runtime") {
      service.readRuntime.mockImplementationOnce(async () => {
        current = false;
        return { status: "running", pid: process.pid };
      });
    } else if (inspection === "command") {
      service.readCommand.mockImplementationOnce(async () => {
        current = false;
        return { programArguments: [] };
      });
    } else {
      beforeIntentWriteAdmission(() => {
        current = false;
      });
    }

    await expect(
      withGatewayServiceUpdateAuthority(
        () => {
          if (!current) {
            throw new Error("update owner revoked");
          }
        },
        () => runServiceRestart(createGatewayServiceRunArgs()),
      ),
    ).rejects.toThrow();

    expectNoRestart();
  },
);
