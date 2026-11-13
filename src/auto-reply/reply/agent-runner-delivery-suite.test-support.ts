import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, expect } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { drainSessionStoreWriterQueuesForTest } from "../../config/sessions/store-writer-state.test-support.js";
import type { ReplyOperation } from "../../sessions/session-controller.js";
import { disposeOmnipolymathAgentDatabaseByPath } from "../../state/omnipolymath-agent-db-disposal.js";
import {
  closeOmnipolymathAgentDatabasesAsync,
  isOmnipolymathAgentDatabaseOpen,
  openOmnipolymathAgentDatabase,
} from "../../state/omnipolymath-agent-db.js";
import { createAgentAccountingPersistenceFixture } from "./agent-runner-result-accounting.persistence.test-support.js";

export function createDeliverySuite() {
  const tempDirs = useAutoCleanupTempDirTracker(afterEach);
  const operations: ReplyOperation[] = [];
  let suiteRoot: string;
  let storePath: string;
  let fixtureSequence = 0;
  beforeAll(() => {
    // omnipolymath-temp-dir: allow suite database root drains before removal
    suiteRoot = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "omnipolymath-accounting-suite-"),
    );
    storePath = path.join(suiteRoot, "omnipolymath-agent.sqlite");
    openOmnipolymathAgentDatabase({ agentId: "main", path: storePath });
  });
  afterAll(async () => {
    await drainSessionStoreWriterQueuesForTest();
    await disposeOmnipolymathAgentDatabaseByPath(storePath);
    await closeOmnipolymathAgentDatabasesAsync(suiteRoot);
    expect(isOmnipolymathAgentDatabaseOpen(storePath)).toBe(false);
    fs.rmSync(suiteRoot, { recursive: true, force: true });
  });
  afterEach(() => {
    for (const operation of operations.splice(0)) {
      operation.complete();
    }
  });
  return {
    get storePath() {
      return storePath;
    },
    createFixture: () =>
      createAgentAccountingPersistenceFixture({
        storePath,
        root: tempDirs.make("omnipolymath-context-pressure-"),
        fixtureId: ++fixtureSequence,
        registerOperation: (operation) => {
          operations.push(operation);
        },
      }),
    async reopen() {
      await drainSessionStoreWriterQueuesForTest();
      await disposeOmnipolymathAgentDatabaseByPath(storePath);
      openOmnipolymathAgentDatabase({ agentId: "main", path: storePath });
    },
  };
}
