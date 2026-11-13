import { executeExistingOmnipolymathStateRead } from "../state/omnipolymath-state-db-readonly.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";

export type AsyncDebugProxyCaptureReader = {
  getSessionEvents(sessionId: string, limit?: number): Promise<Array<Record<string, unknown>>>;
  readBlob(blobId: string): Promise<string | null>;
};

/** Capture the read target without opening or creating its database. */
export function createDebugProxyCaptureReaderAsync(params: {
  env: NodeJS.ProcessEnv;
}): AsyncDebugProxyCaptureReader {
  const context = captureOmnipolymathStateWorkerContext({ env: params.env });
  return {
    async getSessionEvents(sessionId, limit) {
      const result = await executeExistingOmnipolymathStateRead(
        { env: context.environment, path: context.admission.databasePath },
        { type: "capture.readOnlyEvents", sessionId, limit },
        { context },
      );
      context.admission.assertCurrent();
      return result?.events ?? [];
    },
    async readBlob(blobId) {
      const result = await executeExistingOmnipolymathStateRead(
        { env: context.environment, path: context.admission.databasePath },
        { type: "capture.readOnlyBlob", blobId },
        { context },
      );
      context.admission.assertCurrent();
      return result?.blob ?? null;
    },
  };
}
