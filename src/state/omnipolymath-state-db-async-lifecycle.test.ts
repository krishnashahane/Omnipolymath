import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { acquireGatewayStateOwner } from "../infra/gateway-state-owner.js";
import type { DatabasePathIdentity } from "../infra/sqlite-worker-identity.js";
import * as databaseIdentity from "../infra/sqlite-worker-identity.js";
import { createDeferredCore } from "../shared/deferred.js";
import {
  createOmnipolymathDatabaseMaintenanceScope,
  createOmnipolymathStateDatabaseAsyncLifecycle,
} from "./omnipolymath-state-db-async-lifecycle.js";
import {
  clearOmnipolymathStateDatabaseOpenFailure,
  prepareOmnipolymathStateDatabaseRemoval,
  captureOmnipolymathStateDatabaseReadAdmission,
  closeOmnipolymathStateDatabaseAsync,
  closeOmnipolymathStateDatabaseByPath,
  closeOmnipolymathStateDatabaseByPathAsync,
  publishOmnipolymathStateDatabaseWorkerAdmission,
  registerOmnipolymathStateDatabaseAsyncResource,
  registerOmnipolymathStatePathAsyncResource,
} from "./omnipolymath-state-db-cache.js";
import { openOmnipolymathStateReadConnection } from "./omnipolymath-state-db-read-connection.js";
import { withExistingOmnipolymathStateSchema } from "./omnipolymath-state-db-schema-policy.js";
import { openOmnipolymathStateDatabase } from "./omnipolymath-state-db.js";
import {
  captureOmnipolymathStateReadContext,
  prepareOmnipolymathStateReadSource,
} from "./omnipolymath-state-worker-context.js";

const dirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    await closeOmnipolymathStateDatabaseAsync();
    cleanup();
  }),
);

function databasePath(name = "state") {
  return path.join(dirs.make("omnipolymath-async-drain-"), `${name}.sqlite`);
}

function expectOpen(open: boolean, ...handles: { readonly isOpen: boolean }[]) {
  expect(handles.map((handle) => handle.isOpen)).toEqual(handles.map(() => open));
}

function holdReader(
  reader: ReturnType<typeof openOmnipolymathStateReadConnection>,
  identity: DatabasePathIdentity,
) {
  const entered = createDeferredCore();
  const finish = createDeferredCore();
  const unregister = registerOmnipolymathStateDatabaseAsyncResource({
    async close(target) {
      if (target === undefined || target.key === identity.key) {
        entered.resolve();
        await finish.promise;
        reader.close();
      }
    },
  });
  return { entered, finish, unregister };
}

describe("canonical shared-state resource drainage", () => {
  it("targets registered admissions after first creation and drains all on global close", async () => {
    const lifecycle = createOmnipolymathStateDatabaseAsyncLifecycle();
    const firstPath = databasePath("first");
    const secondPath = databasePath("second");
    const first = lifecycle.capture(firstPath);
    const initialKey = first.identity.key;
    const closeFirst = vi.fn(async () => {});
    const closeSecond = vi.fn(async () => {});
    lifecycle.register({ admission: first, close: closeFirst });
    writeFileSync(firstPath, "");
    writeFileSync(secondPath, "");
    lifecycle.publish(firstPath);
    const second = lifecycle.capture(secondPath);
    lifecycle.register({ admission: second, close: closeSecond });
    expect(first.identity.key).not.toBe(initialKey);

    await lifecycle.close(firstPath, () => true);
    expect(closeFirst).toHaveBeenCalledExactlyOnceWith(first.identity);
    expect(closeSecond).not.toHaveBeenCalled();

    await lifecycle.close(undefined, () => true);
    expect(closeFirst).toHaveBeenLastCalledWith(undefined);
    expect(closeSecond).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("reuses warm existing facts without resolving paths or allocating replacement tokens", () => {
    const pathname = databasePath();
    writeFileSync(pathname, "");
    withExistingOmnipolymathStateSchema({ path: pathname }, () => {
      const source = prepareOmnipolymathStateReadSource({ path: pathname });
      const retained = source.current();
      using resolve = vi.spyOn(path, "resolve");
      using identity = vi.spyOn(databaseIdentity, "assertExistingDatabaseIdentity");
      for (let index = 0; index < 100; index++) {
        expect(source.current()).toBe(retained);
      }
      expect(resolve).not.toHaveBeenCalled();
      for (let index = 0; index < 100; index++) {
        source.workerContext();
      }
      expect(identity).not.toHaveBeenCalled();
    });
  });

  it("renews prepared reads of the same file without adopting its replacement", async () => {
    const pathname = databasePath();
    const source = prepareOmnipolymathStateReadSource({ path: pathname });
    const absent = source.current();
    const precreationProof = structuredClone(absent.admission.captureIntegrity?.());
    expect(precreationProof?.identity.key).toMatch(/^path:/);
    const coordinationKey = absent.admission.coordinationKey;
    writeFileSync(pathname, "");
    const created = source.current();
    expect(created.admission.identity.key).toMatch(/^file:/);
    expect(created.admission.captureIntegrity?.()?.identity.key).toBe(
      created.admission.identity.key,
    );
    expect(precreationProof?.identity.key).toMatch(/^path:/);
    expect(Atomics.load(new BigInt64Array(precreationProof!.revision), 0)).not.toBe(
      precreationProof!.epoch,
    );
    expect(created.admission.coordinationKey).toBe(coordinationKey);
    absent.admission.assertCurrent();
    await closeOmnipolymathStateDatabaseByPathAsync(pathname);
    const renewed = source.current();
    expect(created.admission.assertCurrent).toThrow(/admission changed/);
    expect(renewed.admission.identity.key).toBe(created.admission.identity.key);
    await closeOmnipolymathStateDatabaseByPathAsync(pathname);
    renameSync(pathname, `${pathname}.retired`);
    writeFileSync(pathname, "");
    const replacement = captureOmnipolymathStateReadContext(pathname);
    expect(replacement.admission.identity.key).not.toBe(created.admission.identity.key);
    expect(source.current).toThrow(/Prepared state read source changed/);
    expect(source.workerContext).toThrow(/Prepared state read source changed/);
  });

  it("keeps captured schema scope lifetime separate from shared physical admission", async () => {
    const pathname = databasePath();
    const ordinary = captureOmnipolymathStateReadContext(pathname);
    const restricted = withExistingOmnipolymathStateSchema({ path: pathname }, () => {
      const context = captureOmnipolymathStateReadContext(pathname);
      writeFileSync(pathname, "");
      const created = captureOmnipolymathStateDatabaseReadAdmission(pathname);
      expect(context.admission.identity.key).toBe(created.identity.key);
      expect(context.admission.identity.key).toMatch(/^file:/);
      context.admission.assertCurrent();
      return { context, source: prepareOmnipolymathStateReadSource({ path: pathname }) };
    });
    expect(restricted.context.admission.assertCurrent).toThrow(/schema admission has ended/);
    expect(restricted.source.current).toThrow(/schema admission has ended/);
    ordinary.admission.assertCurrent();
    captureOmnipolymathStateReadContext(pathname).admission.assertCurrent();
    await closeOmnipolymathStateDatabaseByPathAsync(pathname);
    expect(restricted.source.current).toThrow(/schema admission has ended/);
  });

  it.each(["missing", "directory"] as const)(
    "keeps unrelated owners while closing a never-admitted %s path",
    async (kind) => {
      const pathname = databasePath(kind);
      if (kind === "directory") {
        mkdirSync(pathname);
        expect(() => captureOmnipolymathStateDatabaseReadAdmission(pathname)).toThrow(/regular file/);
        expect(() => openOmnipolymathStateDatabase({ path: pathname })).toThrow(/regular file/);
      }
      const owner = openOmnipolymathStateDatabase({ path: databasePath("retained") });
      const admission = captureOmnipolymathStateDatabaseReadAdmission(owner.path);
      const unregister = registerOmnipolymathStateDatabaseAsyncResource({
        async close(identity) {
          if (identity === undefined) {
            throw new Error("Unexpected global resource drain");
          }
          if (identity.key === admission.identity.key) {
            owner.db.close();
          }
        },
      });
      try {
        expect(closeOmnipolymathStateDatabaseByPath(pathname)).toBe(false);
        expect(await closeOmnipolymathStateDatabaseByPathAsync(pathname)).toBe(false);
        expect(owner.db.isOpen).toBe(true);
        admission.assertCurrent();
        expect(existsSync(pathname)).toBe(kind === "directory");
      } finally {
        unregister();
      }
    },
  );

  it("publishes replacement identity without renewing revoked read authority", async () => {
    const pathname = databasePath();
    writeFileSync(pathname, "original");
    const original = captureOmnipolymathStateDatabaseReadAdmission(pathname);
    const originalKey = original.identity.key;
    const coordinationKey = original.coordinationKey;
    const close = vi.fn(async () => {});
    const unregister = registerOmnipolymathStatePathAsyncResource(original, close);
    try {
      const unrelated = databasePath("unrelated");
      writeFileSync(unrelated, "");
      await closeOmnipolymathStateDatabaseByPathAsync(unrelated);
      expect(close).not.toHaveBeenCalled();
      clearOmnipolymathStateDatabaseOpenFailure(pathname);
      expect(original.assertCurrent).toThrow(/admission changed/);
      renameSync(pathname, `${pathname}.retired`);
      writeFileSync(pathname, "created");
      const physical = databaseIdentity.readDatabasePathIdentitySync(pathname);
      expect(physical.key).not.toBe(originalKey);
      expect(() => publishOmnipolymathStateDatabaseWorkerAdmission(original)).toThrow(
        /admission changed/,
      );
      expect(original.assertCurrent).toThrow(/admission changed/);
      expect(original.coordinationKey).toBe(coordinationKey);
      expect(original.identity.key).toBe(originalKey);
      expect(original.identity.key).not.toBe(physical.key);
      await closeOmnipolymathStateDatabaseByPathAsync(pathname);
      expect(close).toHaveBeenCalledExactlyOnceWith();
    } finally {
      unregister();
    }
  });

  it("normalizes relative paths for identity, invalidation, exclusion, and closure", async () => {
    const lifecycle = createOmnipolymathStateDatabaseAsyncLifecycle();
    const pathname = databasePath();
    const relative = path.relative(process.cwd(), pathname);
    writeFileSync(pathname, "");
    const original = lifecycle.capture(relative);
    expect(original.databasePath).toBe(pathname);
    expect(lifecycle.publish(relative).identity).toEqual(original.identity);
    expect(lifecycle.identity(relative)).toBe(original.identity);
    expect(lifecycle.knownIdentity(relative)).toBe(original.identity);
    lifecycle.invalidate(relative);
    expect(original.assertCurrent).toThrow(/admission changed/);
    const current = lifecycle.capture(pathname);
    const release = lifecycle.holdExclusion(relative);
    try {
      expect(current.assertCurrent).toThrow(/admission is closed/);
      expect(() => lifecycle.capture(pathname)).toThrow(/admission is closed/);
    } finally {
      release();
    }
    expect(lifecycle.knownIdentity(relative)).toBeUndefined();
    const reopened = lifecycle.capture(pathname);
    const retireNative = vi.fn(() => false);
    await lifecycle.close(relative, retireNative);
    expect(retireNative).toHaveBeenCalledWith(reopened.identity);
    expect(reopened.assertCurrent).toThrow(/admission changed/);
  });

  it("retains an unregistered multipath resource after failure and retries only requested paths", async () => {
    const first = openOmnipolymathStateDatabase({ path: databasePath("first") });
    const second = openOmnipolymathStateDatabase({ path: databasePath("second") });
    const firstReader = openOmnipolymathStateReadConnection(first.path, first.path);
    const secondReader = openOmnipolymathStateReadConnection(second.path, second.path);
    const firstIdentity = captureOmnipolymathStateDatabaseReadAdmission(first.path).identity;
    const secondIdentity = captureOmnipolymathStateDatabaseReadAdmission(second.path).identity;
    const failure = new Error("reader close incomplete");
    let failFirst = true;
    const close = vi.fn(async (target?: DatabasePathIdentity) => {
      if (target === undefined || target.key === firstIdentity.key) {
        if (failFirst) {
          throw failure;
        }
        firstReader.close();
      }
      if (target === undefined || target.key === secondIdentity.key) {
        secondReader.close();
      }
    });
    const unregister = registerOmnipolymathStateDatabaseAsyncResource({ close });
    try {
      await expect(closeOmnipolymathStateDatabaseByPathAsync(first.path)).rejects.toBe(failure);
      unregister();
      expectOpen(true, first.db, firstReader.database.db);
      captureOmnipolymathStateDatabaseReadAdmission(first.path).assertCurrent();
      captureOmnipolymathStateDatabaseReadAdmission(second.path).assertCurrent();
      await closeOmnipolymathStateDatabaseByPathAsync(second.path);
      expect(close).toHaveBeenLastCalledWith(secondIdentity);
      expectOpen(false, second.db, secondReader.database.db);
      expect(firstReader.database.db.isOpen).toBe(true);
      failFirst = false;
      await closeOmnipolymathStateDatabaseByPathAsync(first.path);
      expectOpen(false, firstReader.database.db, first.db);
      captureOmnipolymathStateDatabaseReadAdmission(first.path).assertCurrent();
    } finally {
      failFirst = false;
      await closeOmnipolymathStateDatabaseAsync();
      unregister();
    }
  });

  it("retains an unregistered finalizer skipped after an ordinary drain failure", async () => {
    const owner = openOmnipolymathStateDatabase({ path: databasePath() });
    const reader = openOmnipolymathStateReadConnection(owner.path, owner.path);
    const failure = new Error("ordinary resource did not settle");
    const finalize = vi.fn(async () => {
      reader.close();
    });
    const unregisterFinalizer = registerOmnipolymathStateDatabaseAsyncResource({
      phase: "after-resources",
      close: finalize,
    });
    const close = vi.fn<() => Promise<void>>().mockResolvedValue();
    close.mockImplementationOnce(async () => {
      unregisterFinalizer();
      throw failure;
    });
    const unregister = registerOmnipolymathStateDatabaseAsyncResource({ close });
    try {
      await expect(closeOmnipolymathStateDatabaseAsync()).rejects.toBe(failure);
      expect(finalize).not.toHaveBeenCalled();
      expectOpen(true, owner.db, reader.database.db);
      captureOmnipolymathStateDatabaseReadAdmission(owner.path).assertCurrent();
      await closeOmnipolymathStateDatabaseAsync();
      expect(close).toHaveBeenCalledTimes(2);
      expect(finalize).toHaveBeenCalledOnce();
      expectOpen(false, reader.database.db, owner.db);
    } finally {
      unregister();
      unregisterFinalizer();
      reader.close();
      await closeOmnipolymathStateDatabaseAsync();
    }
  });

  it("releases reads after failed drainage and seals them again for each retry", async () => {
    const owner = openOmnipolymathStateDatabase({ path: databasePath() });
    const initial = captureOmnipolymathStateDatabaseReadAdmission(owner.path);
    const failure = new Error("resource did not settle");
    let outcome: Error | undefined = failure;
    let entered = createDeferredCore();
    let finish = createDeferredCore();
    const close = vi.fn(async () => {
      entered.resolve();
      await finish.promise;
      if (outcome) {
        throw outcome;
      }
    });
    const unregister = registerOmnipolymathStateDatabaseAsyncResource({ close });
    const retry = async (
      admitted: ReturnType<typeof captureOmnipolymathStateDatabaseReadAdmission>,
    ) => {
      entered = createDeferredCore();
      finish = createDeferredCore();
      const closing = closeOmnipolymathStateDatabaseByPathAsync(owner.path);
      await entered.promise;
      // Readers admitted after a failed drain are sealed and drained again.
      expect(admitted.assertCurrent).toThrow(/admission is closed/);
      expect(() => captureOmnipolymathStateDatabaseReadAdmission(owner.path)).toThrow(/closed/);
      finish.resolve();
      return closing;
    };
    try {
      await expect(retry(initial)).rejects.toBe(failure);
      expect(owner.db.isOpen).toBe(true);
      expect(initial.assertCurrent).toThrow(/admission changed/);
      const afterFirst = captureOmnipolymathStateDatabaseReadAdmission(owner.path);
      afterFirst.assertCurrent();

      await expect(retry(afterFirst)).rejects.toBe(failure);
      expect(owner.db.isOpen).toBe(true);
      const afterSecond = captureOmnipolymathStateDatabaseReadAdmission(owner.path);
      afterSecond.assertCurrent();

      outcome = undefined;
      await expect(retry(afterSecond)).resolves.toBe(true);
      expect(close).toHaveBeenCalledTimes(3);
      expect(owner.db.isOpen).toBe(false);
      expect(afterSecond.assertCurrent).toThrow(/admission changed/);
      captureOmnipolymathStateDatabaseReadAdmission(owner.path).assertCurrent();
    } finally {
      outcome = undefined;
      finish.resolve();
      unregister();
    }
  });

  it.each(["after failed drainage", "during drainage"] as const)(
    "keeps failed path-close custody when a replacement publishes %s",
    async (timing) => {
      const lifecycle = createOmnipolymathStateDatabaseAsyncLifecycle();
      const pathname = databasePath();
      writeFileSync(pathname, "original");
      const original = lifecycle.capture(pathname).identity;
      const failure = new Error("resource did not settle");
      const entered = createDeferredCore();
      const finish = createDeferredCore();
      const close = vi
        .fn<(identity?: DatabasePathIdentity) => Promise<void>>()
        .mockImplementationOnce(async () => {
          entered.resolve();
          await finish.promise;
          throw failure;
        })
        .mockResolvedValue();
      const unregister = lifecycle.register({ close });
      const retireNative = vi.fn((_identity?: DatabasePathIdentity) => true);
      const replace = () => {
        renameSync(pathname, `${pathname}.retired`);
        writeFileSync(pathname, "replacement");
        return lifecycle.publish(pathname);
      };
      try {
        const failed = lifecycle.close(pathname, retireNative);
        await entered.promise;
        const replacement = timing === "during drainage" ? replace() : undefined;
        finish.resolve();
        await expect(failed).rejects.toBe(failure);
        const published = replacement ?? replace();
        expect(published.identity.key).not.toBe(original.key);
        // Reads at the path must not bind the unretired original file.
        expect(() => lifecycle.capture(pathname)).toThrow(/admission is closed/);
        await expect(lifecycle.close(pathname, retireNative)).resolves.toBe(true);
        expect(close).toHaveBeenLastCalledWith(original);
        expect(retireNative).toHaveBeenCalledOnce();
        expect(retireNative).toHaveBeenCalledWith(original);
        const current = lifecycle.capture(pathname);
        current.assertCurrent();
        expect(current.identity.key).toBe(published.identity.key);
      } finally {
        finish.resolve();
        unregister();
      }
    },
  );

  it("coalesces pending closes and retains the read seal after a native close failure", async () => {
    const owner = openOmnipolymathStateDatabase({ path: databasePath() });
    const nativeClose = owner.db.close.bind(owner.db);
    const failure = new Error("native close incomplete");
    const close = vi.spyOn(owner.db, "close").mockImplementationOnce(() => {
      throw failure;
    });
    try {
      const first = closeOmnipolymathStateDatabaseByPathAsync(owner.path);
      expect(closeOmnipolymathStateDatabaseByPathAsync(owner.path)).toBe(first);
      await expect(first).rejects.toBe(failure);
      expect(owner.db.isOpen).toBe(true);
      expect(() => captureOmnipolymathStateDatabaseReadAdmission(owner.path)).toThrow(/closed/);
      close.mockImplementation(nativeClose);
      await closeOmnipolymathStateDatabaseByPathAsync(owner.path);
      expect(owner.db.isOpen).toBe(false);
      captureOmnipolymathStateDatabaseReadAdmission(owner.path).assertCurrent();
    } finally {
      close.mockRestore();
      await closeOmnipolymathStateDatabaseByPathAsync(owner.path);
    }
  });

  it("keeps worker admission sealed through maintenance preparation until release", async () => {
    const owner = openOmnipolymathStateDatabase({ path: databasePath() });
    const identity = captureOmnipolymathStateDatabaseReadAdmission(owner.path).identity;
    const reader = openOmnipolymathStateReadConnection(owner.path, owner.path);
    const { entered, finish, unregister } = holdReader(reader, identity);
    const processOwner = acquireGatewayStateOwner({ databasePath: owner.path });
    const assertOwnerCurrent = () => processOwner.assertCurrent();
    const maintenance = createOmnipolymathDatabaseMaintenanceScope({
      schemaMaintenance: true,
      assertOwnerCurrent,
      assertDatabaseAccess: processOwner.assertDatabaseAccess,
    });
    const acquiring = maintenance.run(() =>
      prepareOmnipolymathStateDatabaseRemoval(owner.path, assertOwnerCurrent),
    );
    let removal: Awaited<typeof acquiring> | undefined;
    try {
      expect(() => captureOmnipolymathStateDatabaseReadAdmission(owner.path)).toThrow(/closed/);
      await entered.promise;
      expect(reader.database.db.isOpen).toBe(true);
      finish.resolve();
      removal = await acquiring;
      expectOpen(false, reader.database.db, owner.db);
      removal.assertCurrent();
      expect(() => captureOmnipolymathStateDatabaseReadAdmission(owner.path)).toThrow(/closed/);
      removal.release();
      removal = undefined;
      captureOmnipolymathStateDatabaseReadAdmission(owner.path).assertCurrent();
    } finally {
      finish.resolve();
      unregister();
      try {
        removal ??= await acquiring;
        removal.release();
        await maintenance.close();
      } finally {
        processOwner.release();
      }
    }
  });
});
