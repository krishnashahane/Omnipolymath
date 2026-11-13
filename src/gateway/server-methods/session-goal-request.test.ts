import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { openClientCredentialCustody } from "../../infra/client-credential-store.js";
import { loadOrCreateDeviceIdentity } from "../../infra/device-identity.js";
import { acquireGatewayStateOwner } from "../../infra/gateway-state-owner.js";
import {
  closeOmnipolymathStateDatabaseAsync,
  openOmnipolymathStateDatabase,
} from "../../state/omnipolymath-state-db.js";
import { fingerprintSessionGoalRequest } from "./session-goal-request.js";

afterEach(async () => {
  await closeOmnipolymathStateDatabaseAsync();
  vi.unstubAllEnvs();
});
const tempDirs = useAutoCleanupTempDirTracker(afterEach);

it("fingerprints chat sends with the cached identity while state and credential stores are busy", async () => {
  const stateDir = tempDirs.make("omnipolymath-chat-identity-contention-");
  vi.stubEnv("OMNIPOLYMATH_STATE_DIR", stateDir);
  const request = { sessionKey: "agent:test:main", message: "hello" };
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  const exec = vi.spyOn(DatabaseSync.prototype, "exec");
  let expected: string;
  try {
    expected = await fingerprintSessionGoalRequest(request);
    expect(prepare).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  } finally {
    prepare.mockRestore();
    exec.mockRestore();
  }
  await closeOmnipolymathStateDatabaseAsync();

  // Hold maintenance custody without borrowing its database access scope.
  const blocker = acquireGatewayStateOwner({
    databasePath: path.join(stateDir, "state", "omnipolymath.sqlite"),
  });
  try {
    using credentials = openClientCredentialCustody(process.env);
    expect(credentials).toBeDefined();
    expect(() => loadOrCreateDeviceIdentity()).toThrow("Client credential owner is busy");
    expect(() => openOmnipolymathStateDatabase()).toThrow(
      "without an active schema lease or maintenance scope",
    );
    expect(await fingerprintSessionGoalRequest(request)).toBe(expected);
    expect(await fingerprintSessionGoalRequest({ ...request, message: "changed" })).not.toBe(
      expected,
    );
  } finally {
    blocker.release();
  }
});
