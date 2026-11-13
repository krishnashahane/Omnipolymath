import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { setImmediate as nextImmediate } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../test-utils/prepare-compiled-subprocesses.js";
import { createDeferred, withinTest } from "../../test/helpers/promise.js";
import {
  auditDeclaredOmnipolymathHostDependency,
  auditOmnipolymathPeerDependenciesInManagedNpmRoot,
  auditOmnipolymathPeerDependencyLinkSync,
  linkOmnipolymathPeerDependencies,
  reconcileRegisteredOmnipolymathHostLinks,
  relinkOmnipolymathPeerDependenciesInManagedNpmRoot,
  repairInstalledOmnipolymathHostLinks,
} from "./plugin-peer-link.js";
import { cleanupTrackedTempDirs, makeTrackedTempDir } from "./test-helpers/fs-fixtures.js";

const tempDirs: string[] = [];

function writeJson(filePath: string, data: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(data), "utf8");
}

function writePackage(packageDir: string, manifest: Record<string, unknown>) {
  fs.mkdirSync(packageDir, { recursive: true });
  writeJson(path.join(packageDir, "package.json"), manifest);
}

function peerPackage(packageDir: string) {
  writePackage(packageDir, {
    name: path.basename(packageDir),
    peerDependencies: { omnipolymath: "*" },
  });
}

function peerInstall(installedDir: string) {
  return { installedDir, peerDependencies: { omnipolymath: "*" }, logger: {} };
}

function peerFixture(layout = "missing-modules", registered = false, root = makeTempDir()) {
  const extensionsDir = path.join(root, "extensions");
  const parent = registered ? extensionsDir : path.join(root, "node_modules");
  const packageDir = path.join(parent, "peer-plugin");
  const nodeModulesDir = path.join(packageDir, "node_modules");
  const linkPath = path.join(nodeModulesDir, "omnipolymath");
  const oldHost = path.join(root, "old-host");
  peerPackage(packageDir);
  if (layout !== "missing-modules") {
    fs.mkdirSync(nodeModulesDir);
  }
  if (layout === "stale-link") {
    fs.mkdirSync(oldHost);
    fs.symlinkSync(oldHost, linkPath, "junction");
  } else if (layout === "package-copy") {
    writePackage(linkPath, { name: "omnipolymath" });
  }
  return { root, extensionsDir, packageDir, nodeModulesDir, linkPath, oldHost };
}

function registeredRepair(packageDir: string, ...siblings: string[]) {
  return {
    extensionsDir: path.dirname(packageDir),
    installRecords: Object.fromEntries(
      [packageDir, ...siblings].map((installPath) => [
        path.basename(installPath),
        { source: "npm" as const, installPath },
      ]),
    ),
    mode: "repair" as const,
  };
}

function oneShotAuthority() {
  const failure = new Error("update authority revoked");
  const guard = {
    current: true,
    beforePersistentApply: () => {
      if (!guard.current) {
        guard.current = true;
        throw failure;
      }
    },
  };
  return { guard, failure };
}

function expectHostLink(linkPath: string, hostRoot = process.cwd()) {
  expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
  expect(fs.realpathSync(linkPath)).toBe(fs.realpathSync(hostRoot));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  syncBuiltinESMExports();
  cleanupTrackedTempDirs(tempDirs);
});

function makeTempDir() {
  return makeTrackedTempDir("omnipolymath-plugin-peer-link", tempDirs);
}

describe("plugin peer links", () => {
  function standalone(root: string, overrides: Record<string, unknown> = {}) {
    const runtime = path.join(root, "runtime");
    writePackage(runtime, { name: "omnipolymath" });
    writeJson(path.join(root, "manifest.json"), {
      schemaVersion: 1,
      mode: "jit",
      executable: { path: "renamed-host", sha256: "a".repeat(64) },
      runtime: { path: "runtime", sha256: "b".repeat(64) },
      omnipolymath: { version: "2026.10.4", commit: "c".repeat(40) },
      bun: { version: "1.4.3" },
      ...overrides,
    });
    return runtime;
  }

  it("admits a peer installed by another copy of the same standalone build and rebinds on repair", async () => {
    const { root, packageDir, linkPath: peer } = peerFixture();
    const bundle = standalone(path.join(root, "bundle"));
    const seed = standalone(path.join(root, "seed"));
    vi.stubGlobal("__omnipolymathStandaloneRootUrl", new URL(`file://${bundle}/`).href);
    const install = peerInstall(packageDir);
    const linked = await linkOmnipolymathPeerDependencies({ ...install, hostRoot: bundle });
    expect(linked).toEqual({ repaired: 1, skipped: 0 });
    expect(fs.realpathSync(peer)).toBe(fs.realpathSync(bundle));

    vi.stubGlobal("__omnipolymathStandaloneRootUrl", new URL(`file://${seed}/`).href);
    expect(auditOmnipolymathPeerDependencyLinkSync({ packageDir })).toBeNull();
    // Metadata admission is read-only; explicit installation/repair owns rebinding.
    expect(fs.realpathSync(peer)).toBe(fs.realpathSync(bundle));
    expect(await linkOmnipolymathPeerDependencies(install)).toEqual({ repaired: 1, skipped: 0 });
    expect(fs.realpathSync(peer)).toBe(fs.realpathSync(seed));
  });

  it.each([
    ["new commit", { omnipolymath: { version: "2026.10.4", commit: "d".repeat(40) } }],
    ["rebuilt executable", { executable: { path: "renamed-host", sha256: "d".repeat(64) } }],
    ["changed sidecar", { runtime: { path: "runtime", sha256: "d".repeat(64) } }],
    ["unrelated sidecar", { runtime: { path: "other-runtime", sha256: "b".repeat(64) } }],
    ["version only", { omnipolymath: { version: "2026.10.4" } }],
  ])("rejects %s and lets an explicit install re-resolve its host", async (_label, overrides) => {
    const { root, packageDir, linkPath: peer } = peerFixture("missing-link");
    const previous = standalone(path.join(root, "previous"));
    const current = standalone(path.join(root, "current"), overrides);
    fs.symlinkSync(previous, peer, "junction");
    vi.stubGlobal("__omnipolymathStandaloneRootUrl", new URL(`file://${current}/`).href);
    const issue = auditOmnipolymathPeerDependencyLinkSync({ packageDir });
    expect(issue?.reason).toContain("instead of");
    expect(issue?.reason).toContain("omnipolymath doctor --fix");
    expect(fs.realpathSync(peer)).toBe(fs.realpathSync(previous));
    const linked = await linkOmnipolymathPeerDependencies(peerInstall(packageDir));
    expect(linked).toEqual({ repaired: 1, skipped: 0 });
    expect(auditOmnipolymathPeerDependencyLinkSync({ packageDir })).toBeNull();
    expect(fs.realpathSync(peer)).toBe(fs.realpathSync(current));
  });

  describe.each([
    "direct",
    "managed",
    "registered",
    "composed-managed",
    "composed-registered",
  ] as const)("%s repair authority", (entry) => {
    it.each(["missing-modules", "missing-link", "stale-link", "package-copy"] as const)(
      "preserves %s on a one-shot authority refusal during preparation",
      async (layout) => {
        const registered = entry.endsWith("registered");
        const { root, extensionsDir, packageDir, nodeModulesDir, linkPath, oldHost } = peerFixture(
          layout,
          registered,
        );
        const siblingDir = path.join(path.dirname(packageDir), "z-peer-plugin");
        peerPackage(siblingDir);
        const { guard, failure } = oneShotAuthority();
        const warnings: string[] = [];
        const guarded = {
          logger: { warn: (message: string) => warnings.push(message) },
          beforePersistentApply: guard.beforePersistentApply,
        };
        const operation = entry.startsWith("composed-")
          ? repairInstalledOmnipolymathHostLinks({
              managedNpmRoots: registered ? [] : [root],
              extensionsDir,
              installRecords: registered
                ? registeredRepair(packageDir, siblingDir).installRecords
                : {},
              ...guarded,
            })
          : entry === "managed"
            ? relinkOmnipolymathPeerDependenciesInManagedNpmRoot({ npmRoot: root, ...guarded })
            : entry === "registered"
              ? reconcileRegisteredOmnipolymathHostLinks({
                  ...registeredRepair(packageDir, siblingDir),
                  ...guarded,
                })
              : linkOmnipolymathPeerDependencies({ ...peerInstall(packageDir), ...guarded });
        // Revoke after the entry starts and before its first filesystem mutation.
        guard.current = false;
        await expect(operation).rejects.toBe(failure);
        expect(warnings).toEqual([]);
        expect(fs.existsSync(path.join(siblingDir, "node_modules"))).toBe(false);
        if (layout === "stale-link") {
          expectHostLink(linkPath, oldHost);
        } else if (layout === "package-copy") {
          expect(fs.lstatSync(linkPath).isDirectory()).toBe(true);
          expect(fs.readFileSync(path.join(linkPath, "package.json"), "utf8")).toBe(
            '{"name":"omnipolymath"}',
          );
        } else {
          expect(fs.existsSync(linkPath)).toBe(false);
          expect(fs.existsSync(nodeModulesDir)).toBe(layout === "missing-link");
        }
      },
    );
  });

  it.for(["registered", "composed"] as const)(
    "awaits %s peer preparation before checking synchronous apply authority",
    async (entry, { signal }) => {
      const { packageDir, linkPath, oldHost } = peerFixture("stale-link", true);
      const prepared = createDeferred();
      const release = createDeferred();
      let preparationEntered = false;
      const refusal = new Error("registered peer apply authority revoked");
      const beforePersistentApply = vi.fn(() => {
        throw refusal;
      });
      const options = {
        ...registeredRepair(packageDir),
        beforePersistentEffect: async () => {
          preparationEntered = true;
          prepared.resolve();
          await release.promise;
        },
        beforePersistentApply,
      };
      const operation = (
        entry === "registered"
          ? reconcileRegisteredOmnipolymathHostLinks(options)
          : repairInstalledOmnipolymathHostLinks({ ...options, managedNpmRoots: [], logger: {} })
      ).then(
        () => undefined,
        (error: unknown) => error,
      );
      try {
        await withinTest(Promise.race([prepared.promise, operation]), signal);
        expect(preparationEntered).toBe(true);
        expect(beforePersistentApply).not.toHaveBeenCalled();
        expect(fs.readlinkSync(linkPath)).toBe(oldHost);
      } finally {
        release.resolve();
        await operation;
      }
      expect(await operation).toBe(refusal);
      expect(beforePersistentApply).toHaveBeenCalledOnce();
      expect(fs.readlinkSync(linkPath)).toBe(oldHost);
    },
  );

  it.for([false, true])(
    "joins managed repairs before registered repair or failure (reject=%s)",
    async (reject, { signal }) => {
      const first = peerFixture();
      const sibling = peerFixture();
      const registered = peerFixture("missing-modules", true);
      const firstFinished = createDeferred();
      const siblingStarted = createDeferred();
      const release = createDeferred();
      const failure = new Error("managed root could not be read");
      const readdir = fsPromises.readdir.bind(fsPromises);
      const symlink = fs.symlinkSync.bind(fs);
      let reachedFirst = false;
      let completed = false;
      const finishFirst = () => {
        reachedFirst = true;
        firstFinished.resolve();
      };
      vi.spyOn(fsPromises, "readdir").mockImplementation(async (...args) => {
        const directory = String(args[0]);
        if (directory === path.join(sibling.root, "node_modules")) {
          siblingStarted.resolve();
          await release.promise;
        } else if (directory === path.join(first.root, "node_modules")) {
          await siblingStarted.promise;
          if (reject) {
            finishFirst();
            throw failure;
          }
        }
        return await readdir(...args);
      });
      vi.spyOn(fs, "symlinkSync").mockImplementation((...args) => {
        symlink(...args);
        if (String(args[1]) === first.linkPath) {
          finishFirst();
        }
      });
      syncBuiltinESMExports();
      const operation = repairInstalledOmnipolymathHostLinks({
        managedNpmRoots: [first.root, sibling.root],
        installRecords: registeredRepair(registered.packageDir).installRecords,
        extensionsDir: registered.extensionsDir,
        logger: {},
      })
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        )
        .finally(() => {
          completed = true;
        });
      try {
        await withinTest(Promise.race([firstFinished.promise, operation]), signal);
        expect(reachedFirst).toBe(true);
        // Drain the first branch's promise chain while its sibling remains gated.
        await nextImmediate();
        expect(completed).toBe(false);
        expect(fs.existsSync(registered.linkPath)).toBe(false);
      } finally {
        siblingStarted.resolve();
        release.resolve();
        await operation;
      }
      expectHostLink(sibling.linkPath);
      if (reject) {
        expect(await operation).toEqual({ error: failure });
        expect(fs.existsSync(registered.linkPath)).toBe(false);
      } else {
        expect(await operation).toEqual({ value: { managedRepaired: 2, registeredRepaired: 1 } });
        expectHostLink(registered.linkPath);
      }
    },
  );

  it("preserves pending cohort peers while repairing fresh managed and registered siblings", async () => {
    const root = makeTempDir();
    const priorManaged = peerFixture("stale-link", false, path.join(root, "npm"));
    const priorRegistered = peerFixture("stale-link", true, root);
    const freshManaged = peerFixture("missing-modules", false, path.join(root, "fresh-npm"));
    const freshRegistered = path.join(priorRegistered.extensionsDir, "z-peer-plugin");
    peerPackage(freshRegistered);
    const options = { env: { HOME: root, OMNIPOLYMATH_STATE_DIR: root } };
    const { createUpdateRun } = await import("../infra/update-run-ledger.js");
    const { beginPluginCohortRecovery, deletePluginCohortRecovery } =
      await import("../infra/update-run-recovery-store.js");
    const { closeOmnipolymathStateDatabaseByPathAsync } =
      await import("../state/omnipolymath-state-db-cache.js");
    const { resolveOmnipolymathStateSqlitePath } = await import("../state/omnipolymath-state-db.paths.js");
    const { sha256Hex } = await import("../infra/crypto-digest.js");
    try {
      const run = createUpdateRun({ trigger: "cli" }, options);
      const transactionId = randomUUID();
      const fence = { assertCurrent() {} };
      const pair = beginPluginCohortRecovery(
        {
          runId: run.runId,
          transactionId,
          revision: 0,
          claimId: randomUUID(),
          claimKind: "initial",
          handoff: null,
          source: { stateDir: root, configPath: path.join(root, "omnipolymath.json") },
          from: { root, nodePath: process.execPath, version: "2026.10.9", buildId: "old" },
          to: { root, nodePath: process.execPath, version: "2026.10.10", buildId: "new" },
          createdAtMs: 1,
          updatedAtMs: 1,
          effects: [],
          restore: null,
          verification: null,
          primaryFailure: null,
        },
        {
          runId: run.runId,
          transactionId,
          revision: 0,
          disposition: "pending",
          installKey: root,
          priorArtifacts: [priorManaged, priorRegistered].map(({ packageDir }) => {
            const stat = fs.statSync(packageDir, { bigint: true });
            return {
              pluginId: "peer-plugin",
              packageDir,
              identity: {
                realPath: fs.realpathSync(packageDir),
                dev: String(stat.dev),
                ino: String(stat.ino),
                manifestSha256: sha256Hex(fs.readFileSync(path.join(packageDir, "package.json"))),
              },
              markerBefore: null,
              markerAfter: null,
            };
          }),
          artifacts: [],
          publications: [],
          settledPublications: 0,
        },
        fence,
        options,
      );
      const repair = () =>
        repairInstalledOmnipolymathHostLinks({
          ...options,
          ...registeredRepair(priorRegistered.packageDir, freshRegistered),
          managedNpmRoots: [priorManaged.root, freshManaged.root],
          logger: {},
        });
      expect(await repair()).toEqual({ managedRepaired: 1, registeredRepaired: 1 });
      expect(fs.readlinkSync(priorManaged.linkPath)).toBe(priorManaged.oldHost);
      expect(fs.readlinkSync(priorRegistered.linkPath)).toBe(priorRegistered.oldHost);
      expectHostLink(freshManaged.linkPath);
      expectHostLink(path.join(freshRegistered, "node_modules", "omnipolymath"));
      expect(
        auditOmnipolymathPeerDependencyLinkSync({ packageDir: priorManaged.packageDir }),
      ).not.toBeNull();
      expect(
        auditOmnipolymathPeerDependencyLinkSync({ packageDir: priorRegistered.packageDir }),
      ).not.toBeNull();
      deletePluginCohortRecovery(pair, fence, options);
      expect(await repair()).toEqual({ managedRepaired: 1, registeredRepaired: 1 });
      expectHostLink(priorManaged.linkPath);
      expectHostLink(priorRegistered.linkPath);
    } finally {
      await closeOmnipolymathStateDatabaseByPathAsync(resolveOmnipolymathStateSqlitePath(options.env));
    }
  });

  it.each([
    ["managed", false],
    ["managed", true],
    ["registered", false],
    ["registered", true],
  ] as const)("preserves %s manifest read failure policy (callback=%s)", async (kind, callback) => {
    const fixture = peerFixture("missing-modules", kind === "registered");
    const broken = path.join(path.dirname(fixture.packageDir), "a-broken");
    peerPackage(broken);
    fs.writeFileSync(path.join(broken, "package.json"), "{");
    const onPackageReadError = callback ? vi.fn() : undefined;
    const operation = repairInstalledOmnipolymathHostLinks({
      managedNpmRoots: kind === "managed" ? [fixture.root] : [],
      installRecords:
        kind === "registered" ? registeredRepair(fixture.packageDir, broken).installRecords : {},
      extensionsDir: fixture.extensionsDir,
      logger: {},
      onPackageReadError,
    });
    if (onPackageReadError) {
      await expect(operation).resolves.toEqual({
        managedRepaired: kind === "managed" ? 1 : 0,
        registeredRepaired: kind === "registered" ? 1 : 0,
      });
      expect(onPackageReadError).toHaveBeenCalledOnce();
      expect(onPackageReadError).toHaveBeenCalledWith(
        expect.any(SyntaxError),
        broken,
        kind === "managed" ? "managed npm" : "registered",
      );
      expectHostLink(fixture.linkPath);
    } else {
      await expect(operation).rejects.toBeInstanceOf(SyntaxError);
      expect(fs.existsSync(fixture.linkPath)).toBe(false);
    }
    expect(fs.existsSync(path.join(broken, "node_modules"))).toBe(false);
  });

  it.each(["symlink", "directory"] as const)(
    "stops before replacement on a one-shot refusal after removing the old %s",
    async (existingKind) => {
      const { packageDir, linkPath } = peerFixture(
        existingKind === "symlink" ? "stale-link" : "package-copy",
      );
      const { guard, failure } = oneShotAuthority();
      if (existingKind === "symlink") {
        const unlink = fs.unlinkSync.bind(fs);
        vi.spyOn(fs, "unlinkSync").mockImplementation((target) => {
          unlink(target);
          guard.current = false;
        });
        syncBuiltinESMExports();
      } else {
        const rm = fsPromises.rm.bind(fsPromises);
        vi.spyOn(fsPromises, "rm").mockImplementation(async (target, options) => {
          await rm(target, options);
          guard.current = false;
        });
      }
      const warnings: string[] = [];
      await expect(
        linkOmnipolymathPeerDependencies({
          ...peerInstall(packageDir),
          logger: { warn: (message) => warnings.push(message) },
          beforePersistentApply: guard.beforePersistentApply,
        }),
      ).rejects.toBe(failure);
      expect(guard.current).toBe(true);
      expect(fs.existsSync(linkPath)).toBe(false);
      expect(warnings).toEqual([]);
    },
  );

  it("preserves filesystem failure reporting while caller authority remains current", async () => {
    const { packageDir, linkPath } = peerFixture("missing-link");
    const failure = new Error("peer link write denied");
    vi.spyOn(fs, "symlinkSync").mockImplementationOnce(() => {
      throw failure;
    });
    syncBuiltinESMExports();
    const warnings: string[] = [];

    const result = await linkOmnipolymathPeerDependencies({
      ...peerInstall(packageDir),
      beforePersistentApply: () => {},
      logger: { warn: (message) => warnings.push(message) },
    });

    expect(result).toEqual({ repaired: 0, skipped: 1 });
    expect(warnings).toEqual([expect.stringContaining(failure.message)]);
    expect(fs.existsSync(linkPath)).toBe(false);
  });

  it.each(["managed", "registered"] as const)(
    "ignores packages without a host declaration during %s audit and repair",
    async (entry) => {
      const { root, packageDir, linkPath } = peerFixture("missing-modules", entry === "registered");
      const unrelatedDir = path.join(path.dirname(packageDir), "aaa-unrelated-plugin");
      const manifest = { name: "aaa-unrelated-plugin", dependencies: { other: "*" } };
      writePackage(unrelatedDir, manifest);
      const onPackageReadError = vi.fn();
      expect(await auditDeclaredOmnipolymathHostDependency({ packageDir: unrelatedDir })).toBeNull();
      const options = registeredRepair(packageDir, unrelatedDir);
      const audit =
        entry === "registered"
          ? await reconcileRegisteredOmnipolymathHostLinks({
              ...options,
              mode: "audit",
              onPackageReadError,
            })
          : await auditOmnipolymathPeerDependenciesInManagedNpmRoot({
              npmRoot: root,
              onPackageReadError,
            });
      expect(audit.issues.map((issue) => issue.packageName)).toEqual(["peer-plugin"]);
      const repaired =
        entry === "registered"
          ? await reconcileRegisteredOmnipolymathHostLinks({ ...options, onPackageReadError })
          : await relinkOmnipolymathPeerDependenciesInManagedNpmRoot({
              npmRoot: root,
              logger: {},
              onPackageReadError,
            });
      expect(repaired.repaired).toBe(1);
      expectHostLink(linkPath);
      expect(fs.existsSync(path.join(unrelatedDir, "node_modules"))).toBe(false);
      expect(fs.readFileSync(path.join(unrelatedDir, "package.json"), "utf8")).toBe(
        JSON.stringify(manifest),
      );
      expect(onPackageReadError).not.toHaveBeenCalled();
    },
  );

  it("does not replace a foreign package occupying the host link", async () => {
    const { packageDir, linkPath } = peerFixture("package-copy");
    writePackage(linkPath, { name: "not-omnipolymath" });
    const warnings: string[] = [];
    const result = await linkOmnipolymathPeerDependencies({
      ...peerInstall(packageDir),
      peerDependencies: { omnipolymath: ">=2026.0.0" },
      logger: {
        warn: (message) => warnings.push(message),
      },
    });
    expect(result).toEqual({ repaired: 0, skipped: 1 });
    expect(fs.existsSync(path.join(linkPath, "package.json"))).toBe(true);
    expect(warnings.join("\n")).toContain("already exists and is not a symlink");
  });

  it.runIf(process.platform !== "win32").each(["manifest", "node_modules"])(
    "does not follow a registered plugin %s symlink outside its package root",
    async (boundary) => {
      const { root, packageDir, linkPath } = peerFixture(
        boundary === "manifest" ? "package-copy" : "missing-modules",
        true,
      );
      const outsideModules = path.join(root, "outside-node-modules");
      const outsideHost = path.join(outsideModules, "omnipolymath");
      writePackage(outsideHost, { name: "omnipolymath", peerDependencies: { omnipolymath: "*" } });
      if (boundary === "manifest") {
        fs.unlinkSync(path.join(packageDir, "package.json"));
        fs.symlinkSync(
          path.join(outsideHost, "package.json"),
          path.join(packageDir, "package.json"),
          "file",
        );
      } else {
        fs.symlinkSync(outsideModules, path.join(packageDir, "node_modules"), "dir");
      }
      const onPackageReadError = vi.fn((_error: unknown, _failedDir: string) => {});
      const warnings: string[] = [];
      const result = await reconcileRegisteredOmnipolymathHostLinks({
        ...registeredRepair(packageDir),
        ...(boundary === "manifest"
          ? { onPackageReadError }
          : { logger: { warn: (message: string) => warnings.push(message) } }),
      });
      expect(result.repaired).toBe(0);
      if (boundary === "manifest") {
        expect(onPackageReadError.mock.calls[0]?.[1]).toBe(packageDir);
        expect(fs.lstatSync(linkPath).isDirectory()).toBe(true);
      } else {
        expect(fs.lstatSync(outsideHost).isDirectory()).toBe(true);
        expect(warnings.join("\n")).toContain("is not a real directory");
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "repairs a registered npm plugin when the operator-owned extensions root is a symlink",
    async () => {
      const root = makeTempDir();
      const realExtensionsDir = path.join(root, "real-extensions");
      const extensionsDir = path.join(root, "extensions");
      fs.mkdirSync(realExtensionsDir, { recursive: true });
      fs.symlinkSync(realExtensionsDir, extensionsDir, "dir");
      const { packageDir, linkPath } = peerFixture("package-copy", true, root);
      writeJson(path.join(packageDir, "package.json"), {
        name: "email",
        dependencies: { omnipolymath: "2026.7.1" },
      });
      const result = await reconcileRegisteredOmnipolymathHostLinks(registeredRepair(packageDir));

      expect(result.repaired).toBe(1);
      expectHostLink(linkPath);
    },
  );
});
