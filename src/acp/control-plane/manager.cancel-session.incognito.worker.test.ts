import { expect, it, vi } from "vitest";
import { replaceSessionEntry } from "../../config/sessions/session-accessor.js";
import { withOmnipolymathStateDatabaseReadSnapshot } from "../../state/omnipolymath-state-db-readonly.js";
import { openOmnipolymathStateDatabase } from "../../state/omnipolymath-state-db.js";
import * as stateWorker from "../../state/omnipolymath-state-worker-store.js";
import { buildAcpDatabaseSessionKey } from "../runtime/session-meta-keys.js";
import {
  readAcpSessionEntryAsync,
  upsertAcpSessionMeta,
  writeAcpSessionMetaForMigration,
} from "../runtime/session-meta.js";
import { withAcpCancellationFixture } from "./manager.cancel-session.worker.test-support.js";
import { createGate, memoryGuard, startTurn } from "./manager.cancellation-locator.test-support.js";
import { stopAcpControllerTurns } from "./manager.controller-test-support.js";

it.each([
  ["incognito", "clear", "snapshot"],
  ["durable", "same-binding", "live"],
  ["durable", "clear", "live"],
  ["durable", "rebind", "live"],
  ["durable", "owner", "live"],
] as const)(
  "rechecks %s global ACP metadata after a signal wait and %s mutation under %s reads",
  async (sourceKind, change, readScope) => {
    await withAcpCancellationFixture(
      async (f) => {
        const checkMemory = memoryGuard(f, sourceKind);
        const originalMeta = (await readAcpSessionEntryAsync(f.target))?.acp;
        if (!originalMeta) {
          throw new Error("Expected canonical global ACP metadata.");
        }
        const actorGate = createGate("Actor ended before gate.");
        f.getStatus.mockImplementationOnce(() =>
          actorGate.wait().then(() => ({ summary: "ready" })),
        );
        const actorResult = Promise.allSettled([f.manager.getSessionStatus(f.target)]);
        await actorGate.reached(actorResult);
        const mutationGate = createGate("Cancellation ended before mutation gate.");
        const original = stateWorker.runOmnipolymathStateWorkerOperation;
        let paused = false;
        const intercepted = vi
          .spyOn(stateWorker, "runOmnipolymathStateWorkerOperation")
          .mockImplementation((context, operation, options) =>
            original(
              context,
              (worker) =>
                operation({
                  execute: new Proxy(worker.execute, {
                    async apply(execute, receiver, args: Parameters<typeof worker.execute>) {
                      if (!paused && args[0].type === "sessionState.record") {
                        paused = true;
                        await mutationGate.wait();
                      }
                      return Reflect.apply(execute, receiver, args);
                    },
                  }),
                }),
              options,
            ),
          );
        const events: unknown[] = [];
        const runCancellation = () => {
          const turn = startTurn(f, "incognito-parity", {
            text: "private",
            onEvent: (event) => void events.push(event),
          });
          return Promise.allSettled([stopAcpControllerTurns(f.target), turn]);
        };
        const result =
          readScope === "snapshot"
            ? withOmnipolymathStateDatabaseReadSnapshot(runCancellation, { env: f.state.env })
            : runCancellation();
        try {
          await mutationGate.reached(result);
          if (change === "clear") {
            await upsertAcpSessionMeta({ ...f.target, mutate: () => null });
          } else if (change === "owner") {
            await replaceSessionEntry(f.target, {
              sessionId: "cancellation-session",
              lifecycleRevision: "cancellation-lifecycle",
              updatedAt: 200,
              spawnedBy: "agent:other:parent",
            });
          } else {
            writeAcpSessionMetaForMigration({
              env: f.state.env,
              sessionKey: buildAcpDatabaseSessionKey(f.target.sessionKey, "main"),
              lifecycleRevision:
                change === "rebind" ? "replacement-lifecycle" : "cancellation-lifecycle",
              meta: { ...originalMeta, lastActivityAt: 200 },
            });
          }
          mutationGate.open();
          const settled = await result;
          const signals = openOmnipolymathStateDatabase({ env: f.state.env })
            .db.prepare("SELECT kind FROM session_state_events WHERE run_id = ?")
            .all("incognito-parity");
          expect(signals).toEqual(change === "same-binding" ? [{ kind: "run_failed" }] : []);
          const authorityCurrent = change === "same-binding";
          expect(events).toEqual(
            authorityCurrent ? [{ type: "done", status: "cancelled", stopReason: "cancel" }] : [],
          );
          expect(settled).toMatchObject(
            authorityCurrent
              ? [{ status: "fulfilled" }, { status: "fulfilled" }]
              : [{ status: "rejected" }, { status: "rejected" }],
          );
          checkMemory();
          expect(f.runTurn).not.toHaveBeenCalled();
          expect(f.cancel).not.toHaveBeenCalled();
        } finally {
          mutationGate.open();
          intercepted.mockRestore();
          actorGate.open();
          await Promise.allSettled([result, actorResult]);
        }
      },
      {
        sessionKey:
          sourceKind === "incognito"
            ? "agent:main:dashboard:incognito-cancel-parity"
            : "agent:main:acp:signal-cancel-parity",
      },
    );
  },
);
