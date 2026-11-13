import type { DomainScope } from "../../state/omnipolymath-state-worker-store.types.js";

export function workerCredential(credentialHash = "b".repeat(43), sessionId: string | null = null) {
  return { credentialHash, sessionId, rpcSetVersion: 1, expiresAtMs: 2_000 };
}

export function workerReadyPatch(leaseId: string, nodeDeviceId: string) {
  return {
    leaseId,
    nodeDeviceId,
    sharedHost: false,
    bootstrapReceipt: {
      bundleHash: "a".repeat(64),
      omnipolymathVersion: "test",
      protocolFeatures: [],
    },
    credential: workerCredential(),
  };
}
export function interceptWorkerExecution(
  actual: typeof import("../../state/omnipolymath-state-worker-store.js"),
  wrap: (scope: DomainScope) => DomainScope["execute"],
) {
  return {
    ...actual,
    runOmnipolymathStateWorkerOperation: (
      ...[context, operation, options]: Parameters<typeof actual.runOmnipolymathStateWorkerOperation>
    ) =>
      actual.runOmnipolymathStateWorkerOperation(
        context,
        (scope) => operation({ execute: wrap(scope) }),
        options,
      ),
  };
}
