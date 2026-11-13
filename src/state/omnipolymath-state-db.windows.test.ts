import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import * as nodeSqlite from "../infra/node-sqlite.js";
import { mockProcessPlatform } from "../test-utils/vitest-spies.js";
import * as cache from "./omnipolymath-state-db-cache.js";
import * as stateOpen from "./omnipolymath-state-db-open.js";
import * as reads from "./omnipolymath-state-db-readonly.js";
import { withExistingOmnipolymathStateSchema as inSchema } from "./omnipolymath-state-db-schema-policy.js";
import * as state from "./omnipolymath-state-db.js";
import { resolveLeaseDatabasePath } from "./omnipolymath-state-lease-storage.js";
import { captureOmnipolymathStateReadWorkerContext as captureContext } from "./omnipolymath-state-worker-context.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) => {
  afterEach(async () => {
    await state.closeOmnipolymathStateDatabaseAsync();
    state.closeOmnipolymathStateDatabaseForTest();
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    cleanup();
  });
});

it.each([String.raw`C:\Omnipolymath`, String.raw`\\Server\Share\Omnipolymath`])(
  "shares the native writer and admission across Windows spellings under %s",
  async (windowsRoot) => {
    const hostPlatform = process.platform;
    const root = tempDirs.make("omnipolymath-shared-windows-alias-");
    const env = { OMNIPOLYMATH_STATE_DIR: root };
    const options = (pathname: string) => ({ env, path: pathname });
    const physical = state.openOmnipolymathStateDatabase({ env }).path;
    await state.closeOmnipolymathStateDatabaseAsync();
    const ordinary = path.win32.join(windowsRoot, "state", "omnipolymath.sqlite");
    const namespaced = path.win32.toNamespacedPath(ordinary);
    const spellings = new Set([ordinary, namespaced]);

    // Keep SQLite and the cache real; these exact synthetic locators refer to one host file.
    const nativePath = (value: unknown) => (spellings.has(String(value)) ? physical : value);
    const resolve = path.resolve;
    const win32Resolve = path.win32.resolve;
    vi.spyOn(path, "resolve").mockImplementation((...segments) =>
      segments.some((segment) => spellings.has(segment))
        ? win32Resolve(...segments)
        : resolve(...segments),
    );
    const stat = fs.statSync;
    vi.spyOn(fs, "statSync").mockImplementation((...args) =>
      Reflect.apply(stat, fs, [nativePath(args[0]), ...args.slice(1)]),
    );
    const realpath = fs.realpathSync.native;
    vi.spyOn(fs.realpathSync, "native").mockImplementation((...args) =>
      Reflect.apply(realpath, fs.realpathSync, [nativePath(args[0]), ...args.slice(1)]),
    );
    const open = stateOpen.openUnpublishedStateDatabase;
    const fileUri = nodeSqlite.resolveExistingSqliteFileUri;
    vi.spyOn(nodeSqlite, "resolveExistingSqliteFileUri").mockImplementation((pathname, platform) =>
      fileUri(pathname, pathname === physical ? hostPlatform : platform),
    );
    vi.spyOn(stateOpen, "openUnpublishedStateDatabase").mockImplementation((params) => ({
      ...open({ ...params, pathname: physical }),
      path: params.pathname,
    }));
    vi.spyOn(os, "homedir").mockReturnValue(root);
    mockProcessPlatform("win32");
    syncBuiltinESMExports();

    const first = state.openOmnipolymathStateDatabase(options(namespaced));
    const second = state.openOmnipolymathStateDatabase(options(ordinary));
    expect(second.db).toBe(first.db);
    expect(
      resolveLeaseDatabasePath({
        scope: "shared",
        schemaPolicy: "existing",
        options: { path: namespaced },
      }),
    ).toBe(first.path);
    expect(cache.captureOmnipolymathStateDatabaseReadAdmission(namespaced)).toBe(
      cache.captureOmnipolymathStateDatabaseReadAdmission(ordinary),
    );
    expect(state.isOmnipolymathStateDatabaseOpen(namespaced)).toBe(true);
    const borrow = cache.borrowOmnipolymathStateDatabaseForAsyncRead(namespaced);
    expect(borrow?.database.db).toBe(first.db);
    borrow?.release();
    state.runOmnipolymathStateWriteTransaction(({ db }) => {
      state.runOmnipolymathStateWriteTransaction(
        ({ db: nested }) => expect(nested).toBe(db),
        options(ordinary),
      );
    }, options(namespaced));
    inSchema({ path: namespaced }, () => {
      const context = captureContext(options(namespaced));
      inSchema({ path: ordinary }, () => {
        expect(captureContext(options(ordinary)).existingSchemaPath).toBe(
          context.existingSchemaPath,
        );
        expect(context.existingSchemaPath).toBe(first.path);
      });
    });
    const closedReadScope = await reads.withDisposableOmnipolymathStateReads(namespaced, async () =>
      AsyncLocalStorage.snapshot(),
    );
    expect(() =>
      closedReadScope(() =>
        reads.withExistingOmnipolymathStateDatabaseReadOnly(() => undefined, options(ordinary)),
      ),
    ).toThrow("Shared-state read scope is closing or closed");
    expect(cache.closeOmnipolymathStateDatabaseByPath(namespaced)).toBe(true);
    expect(state.isOmnipolymathStateDatabaseOpen(ordinary)).toBe(false);
  },
);
