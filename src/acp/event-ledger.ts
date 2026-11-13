import type { OmnipolymathStateDatabaseOptions } from "../state/omnipolymath-state-db.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import { runOmnipolymathStateWorkerOperation } from "../state/omnipolymath-state-worker-store.js";
import { createAcpPromptUpdates, type AcpEventLedger } from "./event-ledger.types.js";
import type { AcpReplayWorkerOperations } from "./event-ledger.worker-contract.js";

export type { AcpEventLedger, AcpEventLedgerReplay } from "./event-ledger.types.js";

export function createSqliteAcpEventLedger(
  params: OmnipolymathStateDatabaseOptions = {},
): AcpEventLedger {
  const execute = <Key extends keyof AcpReplayWorkerOperations>(
    type: Key,
    input: AcpReplayWorkerOperations[Key]["input"],
  ): Promise<AcpReplayWorkerOperations[Key]["output"]> => {
    const context = captureOmnipolymathStateWorkerContext({ env: params.env, path: params.path });
    return runOmnipolymathStateWorkerOperation(context, (scope) => scope.execute({ type, input }));
  };
  return {
    startSession: (session) => execute("acpReplay.start", { session, now: Date.now() }),
    recordUserPrompt: ({ prompt, ...session }) =>
      execute("acpReplay.append", {
        session,
        events: createAcpPromptUpdates(prompt).map((update) => ({
          update,
          createdAt: Date.now(),
          at: Date.now(),
        })),
      }),
    recordUpdate: ({ update, ...session }) =>
      execute("acpReplay.append", {
        session,
        events: [{ update: structuredClone(update), createdAt: Date.now(), at: Date.now() }],
      }),
    markIncomplete: (session) => execute("acpReplay.incomplete", { ...session, now: Date.now() }),
    readSessionKey: (session) => execute("acpReplay.sessionKey", session),
    readReplay: ({ sessionId, sessionKey }) =>
      execute("acpReplay.read", { kind: "bound", sessionId, sessionKey }),
    readReplayBySessionId: ({ sessionId }) => execute("acpReplay.read", { kind: "id", sessionId }),
    readReplayBySessionKey: ({ sessionKey }) =>
      execute("acpReplay.read", { kind: "key", sessionKey }),
  };
}
