import { createSqliteWorkerOperationAdmission } from "../../infra/sqlite-worker-operation-admission.js";
import { captureOmnipolymathStateWorkerContext } from "../../state/omnipolymath-state-worker-context.js";
import { runOmnipolymathStateWorkerOperation } from "../../state/omnipolymath-state-worker-store.js";
import type { NativeHookRelayBridgeRecord } from "./native-hook-relay-bridge-record.js";
import type {
  NativeHookRelayBridgePruneCandidate,
  NativeHookRelayBridgePruneResult,
} from "./native-hook-relay-store.kernel.js";

export type { NativeHookRelayBridgeRecord } from "./native-hook-relay-bridge-record.js";

type NativeHookRelayBridgeStoreOptions = { stateDbPath?: string };
type NativeHookRelayBridgeWriteParams = NativeHookRelayBridgeStoreOptions & {
  record: NativeHookRelayBridgeRecord;
  updatedAtMs?: number;
  assertCurrent?: () => void;
};

export async function readNativeHookRelayBridgeRecord(
  params: { relayId: string } & NativeHookRelayBridgeStoreOptions,
): Promise<NativeHookRelayBridgeRecord | undefined> {
  const context = captureOmnipolymathStateWorkerContext({ path: params.stateDbPath });
  const input = { relayId: params.relayId };
  return runOmnipolymathStateWorkerOperation(
    context,
    (scope) => scope.execute({ type: "nativeHookRelay.read", input }),
    { existingOnly: true },
  );
}

function persistNativeHookRelayBridgeRecord<
  Type extends "nativeHookRelay.write" | "nativeHookRelay.renew",
>(type: Type, params: NativeHookRelayBridgeWriteParams) {
  const context = captureOmnipolymathStateWorkerContext({ path: params.stateDbPath });
  const input = { record: { ...params.record }, updatedAtMs: params.updatedAtMs ?? Date.now() };
  const assertCurrent = params.assertCurrent;
  return runOmnipolymathStateWorkerOperation(context, (scope) => scope.execute({ type, input }), {
    assertCurrent,
    createAdmission: () => ({
      nativeLocations: [context.admission.databasePath],
      admission: createSqliteWorkerOperationAdmission((request, grant) => {
        if (request.stage !== "transaction") {
          throw new Error("Native hook relay persistence requires transaction admission");
        }
        context.admission.assertCurrent();
        assertCurrent?.();
        grant();
      }),
    }),
  });
}

export async function writeNativeHookRelayBridgeRecord(
  params: NativeHookRelayBridgeWriteParams,
): Promise<void> {
  await persistNativeHookRelayBridgeRecord("nativeHookRelay.write", params);
}

export async function renewOrRestoreNativeHookRelayBridgeRecord(
  params: NativeHookRelayBridgeWriteParams,
): Promise<boolean> {
  return persistNativeHookRelayBridgeRecord("nativeHookRelay.renew", params);
}

export async function deleteNativeHookRelayBridgeRecordIfOwned(params: {
  relayId: string;
  pid: number;
  token: string;
  stateDbPath?: string;
}): Promise<boolean> {
  const context = captureOmnipolymathStateWorkerContext({ path: params.stateDbPath });
  const input = { relayId: params.relayId, pid: params.pid, token: params.token };
  return runOmnipolymathStateWorkerOperation(context, (scope) =>
    scope.execute({ type: "nativeHookRelay.deleteOwned", input }),
  );
}

export async function pruneNativeHookRelayBridgeRecords(params: {
  currentPid: number;
  isPidDead: (pid: number) => boolean | Promise<boolean>;
  stateDbPath?: string;
}): Promise<NativeHookRelayBridgePruneResult[]> {
  const context = captureOmnipolymathStateWorkerContext({ path: params.stateDbPath });
  const nowMs = Date.now();
  const { currentPid, isPidDead } = params;
  return runOmnipolymathStateWorkerOperation(context, async (scope) => {
    const records = await scope.execute({
      type: "nativeHookRelay.listRecords",
      input: undefined,
    });
    const candidates: NativeHookRelayBridgePruneCandidate[] = [];
    for (const record of records) {
      if (nowMs > record.expiresAtMs) {
        candidates.push({ record, reason: "expired" });
        continue;
      }
      if (record.pid !== currentPid && (await isPidDead(record.pid))) {
        candidates.push({ record, reason: "dead-pid" });
      }
    }
    return candidates.length === 0
      ? []
      : scope.execute({ type: "nativeHookRelay.prune", input: { candidates, nowMs } });
  });
}
