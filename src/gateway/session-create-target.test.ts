import { expect, it } from "vitest";
import { withinTest } from "../../test/helpers/promise.js";
import { observeHostDataSql } from "../../test/helpers/sqlite-statement-execution-counter.js";
import { replaceSessionEntrySync } from "../config/sessions/session-accessor.sqlite-entry.js";
import { prepareSessionEntryReplacementDatabase } from "../config/sessions/session-accessor.sqlite-replacement-worker.js";
import { createDeferredCore } from "../shared/deferred.js";
import { resolveOmnipolymathAgentSqlitePath } from "../state/omnipolymath-agent-db.js";
import { captureOmnipolymathAgentDatabaseExecution } from "../state/omnipolymath-agent-execution.js";
import { runOmnipolymathAgentWriteAdmission } from "../state/omnipolymath-agent-write-admission.js";
import { withOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";
import { readSessionCreateTarget } from "./session-create-target.js";
import { resolveGatewaySessionStoreTargetInWorker } from "./session-utils-store-worker.js";

const key = "agent:main:create-target";
const params = {
  cfg: {},
  key,
  commandSource: "test",
  operatorRoleActor: { kind: "system" as const },
};
async function prepareTarget(env: NodeJS.ProcessEnv) {
  const scope = { agentId: "main", sessionKey: key, env };
  replaceSessionEntrySync(scope, { sessionId: "original", updatedAt: 1 });
  const target = await resolveGatewaySessionStoreTargetInWorker({ ...params, env });
  const database = {
    agentId: target.agentId,
    path: resolveOmnipolymathAgentSqlitePath({ agentId: target.agentId, env }),
    env,
  };
  const read = (commitGuard?: () => void) =>
    readSessionCreateTarget({ ...params, commitGuard }, target, "original", [key]);
  return { scope, database, read };
}

it("prepares current target metadata without caller-thread SQLite", async () => {
  await withOmnipolymathTestState({ scenario: "minimal" }, async ({ env }) => {
    const { scope, read } = await prepareTarget(env);
    const metadata = {
      sessionRoot: "/synthetic/current-root",
      skillsSnapshot: { prompt: "current metadata", skills: [] },
    };
    replaceSessionEntrySync(scope, { sessionId: "original", updatedAt: 2, ...metadata });
    const sql = observeHostDataSql();
    try {
      expect(await read()).toMatchObject({
        ok: true,
        value: { sessionId: "original", ...metadata },
      });
      expect(sql.queries).toEqual([]);
    } finally {
      sql.restore();
    }
  });
});

it.for(["revoked caller", "metadata", "database"] as const)(
  "prepares creation with an admitted writer: %s",
  async (preparation, { signal }) => {
    await withOmnipolymathTestState({ scenario: "minimal" }, async ({ env }) => {
      const { database, read } = await prepareTarget(env);
      const execution = captureOmnipolymathAgentDatabaseExecution(database);
      const prepare = () => prepareSessionEntryReplacementDatabase(database, () => {}, execution);
      const entered = createDeferredCore();
      const release = createDeferredCore();
      let writer: Promise<void> | undefined;
      try {
        await prepare();
        writer = runOmnipolymathAgentWriteAdmission(database, async () => {
          entered.resolve();
          await release.promise;
        });
        await withinTest(entered.promise, signal);
        if (preparation === "revoked caller") {
          let current = true;
          const revoked = new Error("creation caller revoked");
          const pending = read(() => {
            if (!current) {
              throw revoked;
            }
          });
          current = false;
          const refused = expect(pending).rejects.toBe(revoked);
          release.resolve();
          await Promise.all([writer, refused]);
        } else if (preparation === "database") {
          await withinTest(prepare(), signal);
        } else {
          expect(await withinTest(read(), signal)).toMatchObject({
            ok: true,
            value: { sessionId: "original", updatedAt: 1 },
          });
        }
      } finally {
        release.resolve();
        await writer;
        await execution.release();
      }
    });
  },
);
