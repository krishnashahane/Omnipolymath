import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  readPersistedQuarantineRow,
  seedOmnipolymathDatabaseQuarantine,
} from "../state/omnipolymath-quarantine-store.test-support.js";
import {
  closeOmnipolymathStateDatabase,
  openOmnipolymathStateDatabase,
} from "../state/omnipolymath-state-db.js";
import { resolveOmnipolymathStateSqlitePath } from "../state/omnipolymath-state-db.paths.js";
import { runDoctorStateSqliteCompact } from "./doctor-state-sqlite-compact.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) => {
  afterEach(() => {
    closeOmnipolymathStateDatabase();
    vi.restoreAllMocks();
    cleanup();
  });
});

function createStateEnv(): NodeJS.ProcessEnv {
  const stateDir = tempDirs.make("omnipolymath-state-compact-");
  return { ...process.env, OMNIPOLYMATH_STATE_DIR: stateDir };
}

function seedStateDatabase(env: NodeJS.ProcessEnv): string {
  const { path: sqlitePath } = openOmnipolymathStateDatabase({ env });
  closeOmnipolymathStateDatabase();
  if (process.platform !== "win32") {
    fs.chmodSync(sqlitePath, 0o666);
  }
  return sqlitePath;
}

function expectOwnerOnlySqlitePermissions(sqlitePath: string): void {
  expect(fs.statSync(path.dirname(sqlitePath)).mode & 0o777).toBe(0o700);
  for (const candidate of [sqlitePath, `${sqlitePath}-wal`, `${sqlitePath}-shm`]) {
    if (fs.existsSync(candidate)) {
      expect(fs.statSync(candidate).mode & 0o777).toBe(0o600);
    }
  }
}

it("reports a missing canonical database as skipped", async () => {
  const env = createStateEnv();

  await expect(runDoctorStateSqliteCompact({ env })).resolves.toEqual({
    mode: "compact",
    path: resolveOmnipolymathStateSqlitePath(env),
    reason: "missing",
    skipped: true,
  });
});

it("clears quarantine and reapplies owner-only permissions after compaction", async () => {
  const env = createStateEnv();
  const sqlitePath = seedStateDatabase(env);
  seedOmnipolymathDatabaseQuarantine({
    env,
    kind: "state",
    path: sqlitePath,
    reason: "corrupt index",
  });

  await runDoctorStateSqliteCompact({ env });

  expect(readPersistedQuarantineRow(sqlitePath, { env })).toBeUndefined();
  if (process.platform !== "win32") {
    expectOwnerOnlySqlitePermissions(sqlitePath);
  }
  expect(openOmnipolymathStateDatabase({ env }).db.isOpen).toBe(true);
});

it.skipIf(process.platform === "win32")(
  "refuses a symlink at the canonical database path",
  async () => {
    const env = createStateEnv();
    const canonicalPath = resolveOmnipolymathStateSqlitePath(env);
    const externalEnv = createStateEnv();
    const externalPath = seedStateDatabase(externalEnv);
    fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
    fs.symlinkSync(externalPath, canonicalPath);

    await expect(runDoctorStateSqliteCompact({ env })).rejects.toThrow(/not a regular file/);
  },
);

it("refuses compaction while this process owns an open shared-state handle", async () => {
  const env = createStateEnv();
  openOmnipolymathStateDatabase({ env });

  await expect(runDoctorStateSqliteCompact({ env })).rejects.toThrow(
    /already open in this process/,
  );
});
