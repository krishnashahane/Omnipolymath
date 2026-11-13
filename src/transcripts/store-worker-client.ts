import { createSqliteWorkerWriteAdmission } from "../infra/sqlite-worker-store.js";
import { executeExistingOmnipolymathStateRead } from "../state/omnipolymath-state-db-readonly.js";
import type { OmnipolymathStateDatabaseOptions } from "../state/omnipolymath-state-db.js";
import type { OmnipolymathStateAsyncLeaseContext } from "../state/omnipolymath-state-lease-context.js";
import { runWithOmnipolymathStateLeaseWorker } from "../state/omnipolymath-state-lease-worker-operation.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import type { OmnipolymathStateWorkerOperations } from "../state/omnipolymath-state-worker-contract.js";
import { runOmnipolymathStateWorkerOperation } from "../state/omnipolymath-state-worker-store.js";
import type { TranscriptExportChunk, TranscriptExportCommand } from "./store-export-contract.js";
import { TranscriptLibraryError } from "./store-read.js";
import type { TranscriptReadRequests } from "./store-worker-contract.js";
import type { TranscriptExportWriteKey } from "./store-worker.types.js";
import type { TranscriptWriteOperations } from "./store-write.worker-contract.js";

/** One captured database generation spans planning, filesystem work, and persistence. */
export function createTranscriptStoreOperation(
  options: Pick<OmnipolymathStateDatabaseOptions, "env" | "path" | "readOnly">,
  assertOwner?: () => void,
) {
  const context = captureOmnipolymathStateWorkerContext(options);
  const readOnly = options.readOnly;
  const assertCurrent = () => {
    context.admission.assertCurrent();
    assertOwner?.();
  };
  return {
    context,
    assertCurrent,
    databaseOptions: { env: context.environment, path: context.admission.databasePath, readOnly },
    async streamExport(
      command: TranscriptExportCommand,
      consume: (chunk: TranscriptExportChunk, signal: AbortSignal) => Promise<void>,
      signal?: AbortSignal,
    ) {
      // Existing canonical schema already includes meeting tables. Only an absent store needs creation.
      if (!context.admission.identity.key.startsWith("file:") && !readOnly) {
        await runOmnipolymathStateWorkerOperation(context, async () => undefined, { assertCurrent });
      }
      const reply = await executeExistingOmnipolymathStateRead(
        { path: context.admission.databasePath, env: context.environment },
        command,
        {
          context,
          signal,
          live: true,
          async onChunkAsync(value, chunkSignal) {
            assertCurrent();
            // SAFETY: The fixed worker command owns the wire shape; callbacks stay in this process.
            await consume(value as TranscriptExportChunk, chunkSignal);
            assertCurrent();
          },
        },
      );
      assertCurrent();
      if (!reply?.ok || reply.type !== "meetingTranscripts.export") {
        throw new Error("Transcript export ended before completion.");
      }
      if (!reply.result.ok) {
        const { type, message, maxBytes } = reply.result.error;
        throw new TranscriptLibraryError(type, message, maxBytes);
      }
      return reply.result.read;
    },
    async writeExport<Key extends TranscriptExportWriteKey>(
      type: Key,
      request: TranscriptWriteOperations[Key]["input"],
      lease: OmnipolymathStateAsyncLeaseContext,
    ): Promise<void> {
      const input = { ...request, readOnly };
      assertCurrent();
      await runWithOmnipolymathStateLeaseWorker(lease, context, (scope, identity) =>
        scope.execute<Key>({ type, input: { ...input, lease: identity } }),
      );
    },
    async read<Key extends keyof TranscriptReadRequests>(
      type: Key,
      request: OmnipolymathStateWorkerOperations[Key]["input"],
    ): Promise<TranscriptReadRequests[Key]["output"]> {
      const input = { ...request, readOnly };
      const result = await runOmnipolymathStateWorkerOperation(
        context,
        (scope) => scope.execute<Key>({ type, input }),
        { assertCurrent },
      );
      assertCurrent();
      if (!result.ok) {
        throw new TranscriptLibraryError(
          result.error.type,
          result.error.message,
          result.error.maxBytes,
        );
      }
      return result.value;
    },
    async write<Key extends keyof TranscriptWriteOperations>(
      type: Key,
      request: TranscriptWriteOperations[Key]["input"],
      assertWriteOwner?: () => void,
    ): Promise<TranscriptWriteOperations[Key]["output"]> {
      const input = { ...request, readOnly };
      const assertWriteCurrent = () => {
        assertCurrent();
        assertWriteOwner?.();
      };
      return runOmnipolymathStateWorkerOperation(
        context,
        (scope) => scope.execute<Key>({ type, input }),
        {
          assertCurrent: assertWriteCurrent,
          createAdmission: createSqliteWorkerWriteAdmission(assertWriteCurrent, [
            context.admission.databasePath,
          ]),
        },
      );
    },
  };
}

export type TranscriptStoreOperation = ReturnType<typeof createTranscriptStoreOperation>;
