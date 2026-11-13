import { once } from "node:events";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { isRecord } from "@omnipolymath/normalization-core/record-coerce";
import { afterEach, expect, it, vi } from "vitest";
import { createDeferred } from "../../test/helpers/promise.js";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { corruptSqliteIndexKey } from "../infra/sqlite-index-corruption.test-support.js";
import {
  clearOmnipolymathStateDatabaseOpenFailure,
  closeOmnipolymathStateDatabaseAsync,
  omnipolymathStateDatabaseCache,
} from "../state/omnipolymath-state-db-cache.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import { executeOmnipolymathStateWorker } from "../state/omnipolymath-state-worker-store.js";
import { observeMainThreadSql } from "../test-utils/main-thread-sql-spies.test-support.js";
import { createMockServerResponse } from "../test-utils/mock-http-response.js";
import { createGatewayRequest } from "./hooks-test-helpers.js";
import { handleGatewayProbeRequest } from "./server-http-probes.js";
import { createReadinessChecker } from "./server/readiness.js";

let cleanupPath: string | undefined;
const dirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    vi.restoreAllMocks();
    await closeOmnipolymathStateDatabaseAsync();
    if (cleanupPath) {
      clearOmnipolymathStateDatabaseOpenFailure(cleanupPath);
    }
    cleanupPath = undefined;
    cleanup();
  }),
);

it("returns 503 with the worker admission refusal after audit index corruption, despite cached healthy channels", async () => {
  const env = { OMNIPOLYMATH_STATE_DIR: dirs.make("omnipolymath-readiness-integrity-") };
  const capture = () => captureOmnipolymathStateWorkerContext({ env });
  const pathname = (cleanupPath = capture().admission.databasePath);
  const read = () =>
    executeOmnipolymathStateWorker(capture(), {
      type: "plugins.conversationBindingApprovals.read",
      input: undefined,
    });
  expect(await read()).toEqual([]);
  await closeOmnipolymathStateDatabaseAsync();

  fs.renameSync(pathname, `${pathname}.template`);
  fs.copyFileSync(`${pathname}.template`, pathname, fs.constants.COPYFILE_EXCL);
  {
    using database = new DatabaseSync(pathname);
    database.exec(`INSERT INTO audit_events
        (event_id, source_id, source_sequence, occurred_at, kind, action, status, actor_type, actor_id)
        VALUES ('alpha', 'source', 1, 1, 'agent_run', 'agent.run.started', 'started', 'agent', 'main')`);
  }
  corruptSqliteIndexKey(pathname, "sqlite_autoindex_audit_events_1", "alpha", "bravo");

  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  const channelManager = {
    getRuntimeSnapshot: vi.fn(() => ({ channels: {}, channelAccounts: {} })),
    getAutostartSuppression: () => null,
    isAmbientAutostartSuppressed: () => false,
  };
  const getReadiness = createReadinessChecker({
    channelManager,
    startedAt: now - 1000,
    getStateDatabaseFailure: () =>
      omnipolymathStateDatabaseCache.getOmnipolymathStateDatabaseRecordedFailure(pathname),
  });
  const probe = async (url: string) => {
    const response = createMockServerResponse();
    expect(
      await handleGatewayProbeRequest(
        createGatewayRequest({ path: url }),
        response,
        url,
        { mode: "none", allowTailscale: false },
        [],
        false,
        undefined,
        getReadiness,
      ),
    ).toBe(true);
    return {
      status: response.statusCode,
      body: response.body === undefined ? undefined : JSON.parse(response.body),
    };
  };
  const mainSql = observeMainThreadSql();
  try {
    expect(await probe("/readyz")).toMatchObject({ status: 200 });
    await expect(read()).rejects.toThrow(/integrity_check.*sqlite_autoindex_audit_events_1/);

    expect(await probe("/readyz")).toMatchObject({
      status: 503,
      body: {
        ready: false,
        failing: ["state-database"],
        stateDatabase: {
          reason: expect.stringMatching(/integrity_check.*sqlite_autoindex_audit_events_1/),
        },
      },
    });
    expect(await probe("/healthz")).toMatchObject({ status: 200 });
    mainSql.expectIdle();

    clearOmnipolymathStateDatabaseOpenFailure(pathname);
    const replyReady = createDeferred();
    let releaseReply: (() => void) | undefined;
    const originalEmit = vi.spyOn(Worker.prototype, "emit");
    originalEmit.mockRestore();
    const replies = vi.spyOn(Worker.prototype, "emit").mockImplementation(function (
      this: Worker,
      event: string | symbol,
      ...args: unknown[]
    ) {
      const reply = args[0];
      if (
        event === "message" &&
        isRecord(reply) &&
        typeof reply.id === "number" &&
        reply.ok === false
      ) {
        replies.mockRestore();
        releaseReply = () => originalEmit.call(this, event, ...args);
        replyReady.resolve();
        return true;
      }
      return originalEmit.call(this, event, ...args);
    });
    // Other worker control frames must not be mistaken for a SQLite refusal.
    const control = new Worker('require("node:worker_threads").parentPort.postMessage(null)', {
      eval: true,
      execArgv: [],
    });
    await once(control, "exit");
    const pending = read();
    const outcome = Promise.allSettled([pending]);
    try {
      await replyReady.promise;
      // An explicit recovery invalidates the captured admission before its old reply arrives.
      clearOmnipolymathStateDatabaseOpenFailure(pathname);
      releaseReply?.();
      releaseReply = undefined;
      expect((await outcome)[0]?.status).toBe("rejected");
      expect(
        omnipolymathStateDatabaseCache.getOmnipolymathStateDatabaseRecordedFailure(pathname),
      ).toBeUndefined();
    } finally {
      replies.mockRestore();
      releaseReply?.();
      await outcome;
    }
  } finally {
    mainSql.restore();
  }
  using preserved = new DatabaseSync(pathname, { readOnly: true });
  expect(preserved.prepare("SELECT event_id FROM audit_events NOT INDEXED").all()).toEqual([
    { event_id: "alpha" },
  ]);
  expect(preserved.prepare("PRAGMA integrity_check").get()?.integrity_check).not.toBe("ok");
});
