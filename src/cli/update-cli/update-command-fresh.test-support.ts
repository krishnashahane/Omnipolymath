import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { createTempDirTracker } from "../../../test/helpers/temp-dir.js";
import * as tempRoot from "../../infra/tmp-omnipolymath-dir.js";
import * as packageMetadata from "../../infra/update-check-package-target.js";
import * as updateCheck from "../../infra/update-check.js";
import * as updateGlobal from "../../infra/update-global.js";
import { createSystemPackageOwnershipInspection } from "../../infra/update-system-package-ownership.js";
import { defaultRuntime } from "../../runtime.js";
import * as processIdentity from "../../shared/pid-alive.js";
import { closeOmnipolymathStateDatabaseForTest } from "../../state/omnipolymath-state-db.js";
import { resolveOmnipolymathStateSqlitePath } from "../../state/omnipolymath-state-db.paths.js";
import { captureTargetDatabaseSchemaContext } from "./schema-preflight.js";
import * as shared from "./shared.js";
import * as databaseContext from "./update-command-database-context.js";
import * as packageDestination from "./update-command-package-destination.js";
import * as packageUpdate from "./update-command-package.js";
import * as commandRun from "./update-command-run.js";
import * as servicePlan from "./update-command-service-plan.js";

export const targetMetadata = {
  version: "2026.9.2",
  nodeEngine: null,
  schemaVersions: { state: 16, agent: 19 },
};

export function writeFreshJson(filename: string, value: unknown) {
  fs.writeFileSync(filename, JSON.stringify(value));
  return filename;
}

export function expectNoFreshCalls(...spies: unknown[]) {
  for (const spy of spies) {
    expect(spy).not.toHaveBeenCalled();
  }
}

export function expectFreshStatePreserved(fixture: { root: string; databasePath: string }) {
  expect(fs.existsSync(fixture.databasePath)).toBe(false);
  expectNoFreshCalls(packageUpdate.stagePackageInstallUpdate);
  expect(fs.readdirSync(fixture.root)).toEqual(["package.json"]);
}

export function denyFreshLeaseRelease(message: string) {
  using db = new DatabaseSync(
    path.join(tempRoot.resolvePreferredOmnipolymathTmpDir(), "managed-update-handoffs.sqlite"),
  );
  db.exec(
    `CREATE TRIGGER deny_refusal_release BEFORE DELETE ON managed_update_handoffs BEGIN SELECT RAISE(FAIL, '${message}'); END`,
  );
}

export function installFreshUpdateFixture() {
  const dirs = createTempDirTracker();
  const fixture: { root: string; databasePath: string; managedServiceNodeRunner?: string } = {
    root: "",
    databasePath: "",
  };
  beforeEach(() => {
    fixture.managedServiceNodeRunner = undefined;
    const home = dirs.make("omnipolymath-update-fresh-preview-");
    fixture.root = path.join(home, "installation");
    fs.mkdirSync(fixture.root);
    writeFreshJson(path.join(fixture.root, "package.json"), {
      name: "omnipolymath",
      version: "2026.9.3",
    });
    vi.stubEnv("HOME", home);
    vi.stubEnv("OMNIPOLYMATH_STATE_DIR", path.join(home, "profile"));
    vi.stubEnv("OMNIPOLYMATH_CONFIG_PATH", path.join(home, "profile", "omnipolymath.json"));
    for (const key of ["PROFILE", "UPDATE_RUN_ID", "UPDATE_RUN_HANDOFF", "UPDATE_POST_CORE"]) {
      vi.stubEnv(`OMNIPOLYMATH_${key}`, undefined);
    }
    fixture.databasePath = resolveOmnipolymathStateSqlitePath(process.env);
    const executorRoot = path.join(home, "executor");
    fs.mkdirSync(executorRoot);
    vi.spyOn(tempRoot, "resolvePreferredOmnipolymathTmpDir").mockReturnValue(executorRoot);
    // The macOS test sandbox denies /bin/ps. Keep real lease ownership and liveness,
    // supplying only the stable self identity that the OS probe cannot read here.
    vi.spyOn(processIdentity, "getFileLockProcessStartTime").mockImplementation((pid) =>
      pid === process.pid ? 1_700_000_000 : null,
    );
    vi.spyOn(defaultRuntime, "writeJson").mockImplementation(() => undefined);
    vi.spyOn(defaultRuntime, "error").mockImplementation(() => undefined);
    vi.spyOn(commandRun, "prepareUpdateCommand").mockImplementation(async (opts) => ({
      startedAt: Date.now(),
      postCoreUpdateResume: false,
      postCoreUpdateChannel: undefined,
      timeoutMs: 5_000,
      shouldRestart: opts.restart !== false,
      requestedChannel: opts.channel === "stable" ? "stable" : null,
      devTarget: undefined,
      controlPlaneUpdateSentinelMeta: null,
      discoveredRoot: fixture.root,
      installKind: "package",
      servicePlan: { rootRedirect: null, nodeRunner: fixture.managedServiceNodeRunner },
      pkgOwnership: createSystemPackageOwnershipInspection(5_000),
    }));
    vi.spyOn(servicePlan, "isGatewayServiceManagementAllowedForUpdate").mockReturnValue(false);
    vi.spyOn(databaseContext, "inspectUpdateDatabaseContexts").mockImplementation(async () => ({
      service: undefined,
      services: new Map(),
      contexts: [await captureTargetDatabaseSchemaContext(process.env)],
      managedEnv: undefined,
    }));
    vi.spyOn(shared, "resolveGlobalManager").mockResolvedValue("npm");
    vi.spyOn(shared, "resolveTargetVersion").mockResolvedValue({ version: "2026.9.2" });
    vi.spyOn(updateGlobal, "createGlobalInstallEnv").mockResolvedValue({ ...process.env });
    vi.spyOn(packageDestination, "inspectNpmGlobalDestination").mockResolvedValue({
      kind: "empty",
    });
    vi.spyOn(updateGlobal, "resolveGlobalInstallTarget").mockResolvedValue({
      manager: "npm",
      command: "npm",
      globalRoot: path.dirname(fixture.root),
      packageRoot: fixture.root,
      npmOwner: { version: "11.10.0", lifecyclePolicy: "unflagged" },
    });
    vi.spyOn(updateCheck, "resolveNpmChannelTag").mockResolvedValue({
      tag: "latest",
      version: "2026.9.2",
    });
    vi.spyOn(packageMetadata, "fetchNpmPackageTargetStatus").mockResolvedValue(targetMetadata);
    vi.spyOn(packageUpdate, "stagePackageInstallUpdate").mockRejectedValue(
      new Error("Read-only update admission must not stage a package"),
    );
  });

  afterEach(() => {
    closeOmnipolymathStateDatabaseForTest();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    dirs.cleanup();
  });

  return { fixture, dirs };
}
