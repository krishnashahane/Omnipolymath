import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { redactRegisteredSecretValues } from "../logging/secret-redaction-registry.js";
import { resetSecretRedactionRegistryForTest } from "../logging/secret-redaction-registry.test-support.js";
import { closeOmnipolymathStateDatabaseByPath } from "../state/omnipolymath-state-db-cache.js";
import { openOmnipolymathStateDatabase } from "../state/omnipolymath-state-db.js";
import { withEnvAsync } from "../test-utils/env.js";
import { createWorkerRuntimeEnvironment } from "./worker.runtime.js";

it("closes the worker state database before removing its directory without closing other state", async () => {
  const unrelatedRoot = await mkdtemp(path.join(tmpdir(), "omnipolymath-worker-unrelated-"));
  const unrelated = openOmnipolymathStateDatabase({
    path: path.join(unrelatedRoot, "omnipolymath.sqlite"),
  });
  const environment = await createWorkerRuntimeEnvironment("worker-state-cleanup");
  const owned = openOmnipolymathStateDatabase();
  try {
    expect(owned.db.isOpen).toBe(true);
    expect(unrelated.db.isOpen).toBe(true);

    await environment.close();

    expect(owned.db.isOpen).toBe(false);
    expect(unrelated.db.isOpen).toBe(true);
    expect(unrelated.db.prepare("SELECT 1 AS value").get()).toEqual({ value: 1 });
    await expect(stat(environment.stateDir)).rejects.toMatchObject({ code: "ENOENT" });
    await environment.close();
  } finally {
    closeOmnipolymathStateDatabaseByPath(owned.path);
    closeOmnipolymathStateDatabaseByPath(unrelated.path);
    await rm(environment.stateDir, { recursive: true, force: true });
    await rm(unrelatedRoot, { recursive: true, force: true });
  }
});

it("registers inherited provider transport before worker tool diagnostics", async () => {
  const header = "synthetic-worker-owned-identity-header";
  resetSecretRedactionRegistryForTest();
  try {
    await withEnvAsync({ IDENTITY_HEADER: header }, async () => {
      const environment = await createWorkerRuntimeEnvironment("identity-redaction");
      try {
        expect(redactRegisteredSecretValues(`failure ${header}`, () => "[REDACTED]")).toBe(
          "failure [REDACTED]",
        );
      } finally {
        await environment.close();
      }
    });
  } finally {
    resetSecretRedactionRegistryForTest();
  }
});
