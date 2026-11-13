/** Runtime reads stay on the shared-state reader; Doctor retains synchronous migration access. */
import { normalizeAgentId } from "../routing/session-key.js";
import { executeExistingOmnipolymathStateRead } from "../state/omnipolymath-state-db-readonly.js";
import type { OmnipolymathStateDatabaseOptions } from "../state/omnipolymath-state-db.js";
import type { OmnipolymathStateReadOptions } from "../state/omnipolymath-state-read.types.js";
import { captureOmnipolymathStateReadWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import type { DefaultProactiveJobReceipt } from "./proactive-job-receipt.types.js";
import { resolveCronStoreKeyAsync } from "./store/paths.js";
import type { CronStoredJob } from "./types.js";

export {
  readDefaultProactiveJobReceiptInDatabase,
  recordDefaultProactiveJobInDatabase,
  recordConvertedProactiveJobInDatabase,
} from "./proactive-job-receipt.kernel.js";
export type { DefaultProactiveJobReceipt } from "./proactive-job-receipt.types.js";

export async function readDefaultProactiveJobReceiptsAsync(
  storePath: string | undefined,
  agentIds: readonly string[],
  options: Pick<OmnipolymathStateDatabaseOptions, "path" | "env"> = {},
  readOptions: Pick<OmnipolymathStateReadOptions, "context" | "current" | "signal"> = {},
): Promise<Record<string, DefaultProactiveJobReceipt>> {
  if (agentIds.length === 0) {
    return {};
  }
  const context = readOptions.context ?? captureOmnipolymathStateReadWorkerContext(options);
  const ids = [...new Set(agentIds.map(normalizeAgentId))];
  const storeKey = await resolveCronStoreKeyAsync(storePath, options.env, context);
  return readDefaultProactiveJobReceiptsByKeyAsync(storeKey, ids, options, readOptions);
}

/** Read receipts without interpreting an already-selected opaque key as a path. */
export async function readDefaultProactiveJobReceiptsByKeyAsync(
  storeKey: string,
  agentIds: readonly string[],
  options: Pick<OmnipolymathStateDatabaseOptions, "path" | "env"> = {},
  readOptions: Pick<OmnipolymathStateReadOptions, "context" | "current" | "signal"> = {},
): Promise<Record<string, DefaultProactiveJobReceipt>> {
  if (agentIds.length === 0) {
    return {};
  }
  const reply = await executeExistingOmnipolymathStateRead(
    options,
    {
      type: "automationProactive.receipts",
      input: {
        storeKey,
        agentIds: [...new Set(agentIds.map(normalizeAgentId))],
      },
    },
    readOptions,
  );
  if (!reply) {
    return {};
  }
  if (!reply.ok || reply.type !== "automationProactive.receipts") {
    throw new Error("Default automation receipt read did not return its admitted snapshot");
  }
  return reply.receipts;
}

/** Diagnostics observe completed cutovers and their surviving jobs in one snapshot. */
export async function readDefaultProactiveJobsAsync(
  storePath: string | undefined,
  agentIds: readonly string[],
  options: Pick<OmnipolymathStateDatabaseOptions, "path" | "env"> = {},
): Promise<CronStoredJob[]> {
  if (agentIds.length === 0) {
    return [];
  }
  const context = captureOmnipolymathStateReadWorkerContext(options);
  const storeKey = await resolveCronStoreKeyAsync(storePath, options.env, context);
  return readDefaultProactiveJobsByKeyAsync(storeKey, agentIds, options);
}

/** Diagnostics reuse the scheduler's selected partition without a selection probe. */
export async function readDefaultProactiveJobsByKeyAsync(
  storeKey: string,
  agentIds: readonly string[],
  options: Pick<OmnipolymathStateDatabaseOptions, "path" | "env"> = {},
): Promise<CronStoredJob[]> {
  if (agentIds.length === 0) {
    return [];
  }
  const reply = await executeExistingOmnipolymathStateRead(options, {
    type: "automationProactive.jobs",
    input: {
      storeKey,
      agentIds: [...new Set(agentIds.map(normalizeAgentId))],
    },
  });
  if (!reply) {
    return [];
  }
  if (!reply.ok || reply.type !== "automationProactive.jobs") {
    throw new Error("Default automation job read did not return its admitted snapshot");
  }
  return reply.jobs;
}
