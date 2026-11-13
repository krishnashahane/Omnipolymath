import { requestSqliteWorkerOperationAdmission } from "../../infra/sqlite-worker-operation-admission.js";
import type { OmnipolymathStateDatabase } from "../../state/omnipolymath-state-db-contract.js";
import { withOmnipolymathStateDatabaseReadOnly } from "../../state/omnipolymath-state-db-readonly.js";
import { runOmnipolymathStateWriteTransaction } from "../../state/omnipolymath-state-db.js";
import type {
  WorkerOperationContext,
  WorkerOperationHandlers,
} from "../../state/worker-operation-registry.js";
import * as store from "./native-hook-relay-store.kernel.js";

function relayMutation<Input, Output>(
  mutate: (database: OmnipolymathStateDatabase, input: Input) => Output,
  requiresAdmission = false,
) {
  return (input: Input, { open, stateOptions }: WorkerOperationContext): Output =>
    runOmnipolymathStateWriteTransaction(
      (database) => {
        if (requiresAdmission) {
          requestSqliteWorkerOperationAdmission({ stage: "transaction", facts: undefined });
        }
        return mutate(database, input);
      },
      { database: open(), ...stateOptions() },
    );
}

export const nativeHookRelayOperations = {
  "nativeHookRelay.read": (input: { relayId: string }, { stateOptions }) =>
    withOmnipolymathStateDatabaseReadOnly(
      (database) =>
        store.readNativeHookRelayBridgeRecordFromDatabase({ database, relayId: input.relayId }),
      stateOptions(),
    ),
  "nativeHookRelay.listRecords": (_input: undefined, { open }) =>
    store.listNativeHookRelayBridgeRecordsInDatabase(open()),
  "nativeHookRelay.write": relayMutation(store.writeNativeHookRelayBridgeRecordInDatabase, true),
  "nativeHookRelay.renew": relayMutation(
    store.renewOrRestoreNativeHookRelayBridgeRecordInDatabase,
    true,
  ),
  "nativeHookRelay.deleteOwned": relayMutation(
    store.deleteNativeHookRelayBridgeRecordIfOwnedInDatabase,
  ),
  "nativeHookRelay.prune": relayMutation(
    (database, input: { candidates: store.NativeHookRelayBridgePruneCandidate[]; nowMs: number }) =>
      store.pruneNativeHookRelayBridgeRecordsInDatabase(database, input.candidates, input.nowMs),
  ),
} satisfies WorkerOperationHandlers;
