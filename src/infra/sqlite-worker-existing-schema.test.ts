import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { closeOmnipolymathStateDatabaseAsync } from "../state/omnipolymath-state-db-cache.js";
import { withExistingOmnipolymathStateSchema } from "../state/omnipolymath-state-db-schema-policy.js";
import { openOmnipolymathStateDatabase } from "../state/omnipolymath-state-db.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import {
  executeOmnipolymathStateWorker,
  createOmnipolymathStateWorkerLease,
  openOmnipolymathStateWorkerCleanupStore,
} from "../state/omnipolymath-state-worker-store.js";
import { withGatewayServiceInstallation } from "./gateway-service-installation-context.js";
import { openNodeSqliteDatabase } from "./node-sqlite.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    await closeOmnipolymathStateDatabaseAsync();
    cleanup();
  }),
);

function readAppVersion(databasePath: string) {
  const db = openNodeSqliteDatabase(databasePath, { readOnly: true });
  try {
    return db.prepare("SELECT app_version FROM schema_meta WHERE meta_key = 'primary'").get()
      ?.app_version;
  } finally {
    db.close();
  }
}

async function fixture() {
  const env = { OMNIPOLYMATH_STATE_DIR: tempDirs.make("worker-existing-schema-") };
  const { db, path: databasePath } = openOmnipolymathStateDatabase({ env });
  db.prepare("UPDATE schema_meta SET app_version = ? WHERE meta_key = 'primary'").run(
    "synthetic-installed-runtime",
  );
  await closeOmnipolymathStateDatabaseAsync();
  return { env, databasePath };
}

function read(context: ReturnType<typeof captureOmnipolymathStateWorkerContext>) {
  return executeOmnipolymathStateWorker(context, {
    type: "plugins.conversationBindingApprovals.read",
    input: undefined,
  });
}

describe("shared-state worker schema policies", () => {
  it("preserves active service policy through a natively published hardlink and symlink", async () => {
    const { env, databasePath } = await fixture();
    captureOmnipolymathStateWorkerContext({ path: databasePath, env });
    const serviceDir = path.join(env.OMNIPOLYMATH_STATE_DIR, "service");
    const aliasDir = path.join(env.OMNIPOLYMATH_STATE_DIR, "service-alias");
    await fs.mkdir(serviceDir);
    const servicePath = path.join(serviceDir, "omnipolymath.sqlite");
    await fs.link(databasePath, servicePath);
    await fs.symlink(serviceDir, aliasDir, process.platform === "win32" ? "junction" : "dir");
    const aliasPath = path.join(aliasDir, "omnipolymath.sqlite");
    openOmnipolymathStateDatabase({ path: aliasPath, env });
    const installation = {
      root: "/synthetic-installed-runtime",
      version: "2026.10.1",
      cliVersion: "2026.10.9",
      databasePath: servicePath,
    };
    await withGatewayServiceInstallation({ installation }, async () => {
      const captured = captureOmnipolymathStateWorkerContext({ path: aliasPath, env });
      const lease = createOmnipolymathStateWorkerLease(captured);
      try {
        await lease.ready;
        await withGatewayServiceInstallation(
          { installation: { ...installation, version: "2026.10.2" } },
          async () => {
            await expect(
              read(captureOmnipolymathStateWorkerContext({ path: aliasPath, env })),
            ).rejects.toThrow("policy changed while its actor is in use");
          },
        );
      } finally {
        await lease.release();
      }
    });
  });

  it("reopens the whole actor when schema policy changes with a cleanup client retained", async () => {
    const { env, databasePath } = await fixture();
    const captured = captureOmnipolymathStateWorkerContext({ path: databasePath, env });
    expect(await read(captured)).toEqual([]);
    const cleanup = await openOmnipolymathStateWorkerCleanupStore(
      databasePath,
      captured,
      () => {},
      captured.admission.identity,
    );
    expect(cleanup).toBeDefined();

    await withGatewayServiceInstallation(
      {
        installation: {
          root: "/synthetic-installed-runtime",
          version: "2026.10.1",
          cliVersion: "2026.10.9",
          databasePath,
        },
      },
      async () => {
        const installed = captureOmnipolymathStateWorkerContext({ path: databasePath, env });
        expect(await read(installed)).toEqual([]);
      },
    );

    expect(readAppVersion(databasePath)).toBe("synthetic-installed-runtime");
    await cleanup?.close();
  });

  it("admits queued checks only while their captured existing-schema scope remains active", async () => {
    const { env, databasePath } = await fixture();
    const outsideScope = AsyncLocalStorage.snapshot();
    const captured = await withExistingOmnipolymathStateSchema({ path: databasePath }, async () => {
      const context = captureOmnipolymathStateWorkerContext({ env });
      expect(() => outsideScope(context.admission.assertCurrent)).not.toThrow();
      expect(await outsideScope(() => read(context))).toEqual([]);
      expect(readAppVersion(databasePath)).toBe("synthetic-installed-runtime");
      return context;
    });

    await expect(read(captured)).rejects.toThrow("schema admission has ended");
    expect(readAppVersion(databasePath)).toBe("synthetic-installed-runtime");
  });
});
