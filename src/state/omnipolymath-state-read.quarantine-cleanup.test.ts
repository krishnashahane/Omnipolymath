import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type {
  OmnipolymathStateReadReply,
  OmnipolymathStateReadRequest,
} from "./omnipolymath-state-read.types.js";

type FakeDatabase = {
  isOpen: boolean;
  exec: () => void;
  prepare: (sql: string) => { get: () => unknown };
  close: () => void;
};
const mock = vi.hoisted(() => ({
  handler: vi.fn<(input: unknown) => Promise<OmnipolymathStateReadReply>>(),
  open: vi.fn<(location: string) => FakeDatabase>(),
  read: vi.fn<(sql: string) => unknown>(),
  close: vi.fn<() => void>(),
  query: vi.fn<() => []>(),
  claimAgentLease: vi.fn(() => "quarantine-test-lease"),
}));
vi.mock("../infra/worker-task-server.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../infra/worker-task-server.js")>()),
  serveOwnedWorkerTasks: (handler: (input: unknown) => Promise<OmnipolymathStateReadReply>) => {
    mock.handler.mockImplementation(handler);
  },
}));
vi.mock("../infra/node-sqlite.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../infra/node-sqlite.js")>()),
  openNodeSqliteDatabase: mock.open,
}));
vi.mock("./backup-run-records.kernel.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./backup-run-records.kernel.js")>()),
  readBackupRunsInDatabase: mock.query,
}));
vi.mock("./omnipolymath-agent-db-lease.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./omnipolymath-agent-db-lease.js")>()),
  claimOmnipolymathAgentDatabaseLease: mock.claimAgentLease,
  releaseOmnipolymathAgentDatabaseLease: vi.fn(),
}));
vi.mock("./omnipolymath-state-db-read-connection.js", () => ({
  closeRetainedOmnipolymathStateReadConnections: vi.fn(),
  withOmnipolymathStateReadOnlyLocation: (operation: (source: { db: object }) => unknown) =>
    operation({ db: {} }),
}));

import "./omnipolymath-state-read.worker.js";
import {
  closeOmnipolymathAgentDatabasesForTest,
  openOmnipolymathAgentDatabase,
} from "./omnipolymath-agent-db.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => closeOmnipolymathAgentDatabasesForTest());
beforeEach(() => {
  mock.read.mockReset().mockReturnValue({ user_version: 0 });
  mock.close.mockReset();
  mock.query.mockReset().mockReturnValue([]);
  mock.claimAgentLease.mockClear();
  mock.open.mockReset().mockImplementation((location) => {
    if (!location.endsWith("omnipolymath-quarantine.sqlite")) {
      throw new Error(`Unexpected source database open: ${location}`);
    }
    const database: FakeDatabase = {
      isOpen: true,
      exec() {},
      prepare: (sql) => ({ get: () => mock.read(sql) }),
      close() {
        mock.close();
        database.isOpen = false;
      },
    };
    return database;
  });
});

function request(): OmnipolymathStateReadRequest {
  const root = tempDirs.make("omnipolymath-quarantine-cleanup-");
  const state = path.join(root, "state");
  fs.mkdirSync(state);
  // Only existence/identity are real; every SQLite connection is a plain mocked object.
  fs.writeFileSync(path.join(state, "omnipolymath-quarantine.sqlite"), "mock quarantine store");
  const databasePath = path.join(state, "omnipolymath.sqlite");
  fs.writeFileSync(databasePath, "mock state source");
  return {
    context: { environment: { OMNIPOLYMATH_STATE_DIR: root } },
    databasePath,
    location: databasePath,
    checkFreshAdmission: true,
    command: { type: "backup.runs" },
  };
}

function knownQuarantine(kind: "state" | "agent") {
  const reason = "verified synthetic database damage";
  mock.read.mockImplementation((sql) =>
    sql === "PRAGMA user_version"
      ? { user_version: 2 }
      : { user_version: 2, kind, reason, quarantined_at: 1, verified_generation: null },
  );
  return reason;
}

function fail(error: Error) {
  return () => {
    throw error;
  };
}

function openFailure(options: Parameters<typeof openOmnipolymathAgentDatabase>[0]) {
  try {
    openOmnipolymathAgentDatabase(options);
  } catch (error) {
    assert(error instanceof Error);
    return error;
  }
  throw new Error("Expected agent database admission to fail");
}

it.each([
  ["state", true, false, false],
  ["state", true, false, true],
  ["state", false, false, true],
  ["state", false, true, true],
  ["state", false, true, false],
  ["agent", true, false, true],
  ["agent", false, false, true],
  ["agent", false, true, true],
] as const)(
  "%s quarantine: known=%s, read failure=%s, close failure=%s",
  async (kind, known, readFails, closeFails) => {
    const input = request();
    const reason = known ? knownQuarantine(kind) : undefined;
    const readFailure = new Error("quarantine metadata read failed");
    const closeFailure = new Error("quarantine native reader close failed");
    const failures = [...(readFails ? [readFailure] : []), closeFailure];
    const configure = kind === "state" ? "mockImplementationOnce" : "mockImplementation";
    if (readFails) {
      mock.read[configure](fail(readFailure));
    }
    if (closeFails) {
      mock.close[configure](fail(closeFailure));
    }
    if (kind === "state") {
      const reply = await mock.handler(input);
      if (known) {
        expect(reply).toMatchObject({ ok: false, message: expect.stringContaining(reason!) });
        expect(reply).not.toHaveProperty("sourceAdmitted", true);
      } else if (closeFails) {
        expect(reply).toMatchObject({ ok: true, type: "backup.runs", runs: [] });
      } else {
        expect(reply).toEqual({ ok: true, type: "backup.runs", sourceAdmitted: true, runs: [] });
      }
      if (closeFails) {
        expect(reply.nativeCleanupFailure?.error?.nodes).toEqual(
          expect.arrayContaining(
            failures.map(({ message }) => expect.objectContaining({ message })),
          ),
        );
      } else {
        expect(reply.nativeCleanupFailure).toBeUndefined();
      }
      expect(mock.query).toHaveBeenCalledTimes(known ? 0 : 1);
      expect(mock.close).toHaveBeenCalledOnce();
      return;
    }
    const agentPath = path.join(path.dirname(input.databasePath), "omnipolymath-agent.sqlite");
    fs.writeFileSync(agentPath, "mock agent source");
    const options = {
      agentId: "quarantine-agent",
      path: agentPath,
      env: input.context.environment,
    };
    let firstFailure: Error | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failure = openFailure(options);
      if (known) {
        expect(failure).toMatchObject({
          name: "SqliteIntegrityError",
          message: expect.stringContaining(reason!),
          cause: { errors: [closeFailure] },
        });
        if (attempt === 1) {
          expect(failure).toBe(firstFailure);
        }
      } else {
        expect(failure).toBeInstanceOf(AggregateError);
        expect(failure).toMatchObject({
          name: "OmnipolymathQuarantineReadCleanupError",
          errors: failures,
        });
        expect(failure.cause).toBe(readFails ? readFailure : closeFailure);
      }
      firstFailure = failure;
      expect(mock.open).toHaveBeenCalledTimes(known ? 1 : attempt + 1);
      expect(mock.close).toHaveBeenCalledTimes(known ? 1 : attempt + 1);
    }
    expect(mock.claimAgentLease).not.toHaveBeenCalled();
  },
);
