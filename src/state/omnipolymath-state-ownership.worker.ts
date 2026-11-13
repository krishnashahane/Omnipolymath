import { routeLogsToStderr } from "../logging/console.js";
import type { OmnipolymathStateOwnershipWorkerReply } from "./omnipolymath-state-ownership-worker.js";
import {
  inspectOmnipolymathStateOwnershipInProcess,
  type OmnipolymathExternalStateOwnership,
} from "./omnipolymath-state-ownership.js";
import { encodeOmnipolymathStateWorkerError } from "./omnipolymath-state-worker-error.js";

function inspect(databasePath: string | undefined): OmnipolymathStateOwnershipWorkerReply {
  try {
    if (!databasePath) {
      throw new Error("Shared-state ownership worker requires a database path");
    }
    const ownership: OmnipolymathExternalStateOwnership | null =
      inspectOmnipolymathStateOwnershipInProcess(databasePath);
    return { ok: true, ownershipJson: JSON.stringify(ownership) };
  } catch (error) {
    const workerError = encodeOmnipolymathStateWorkerError(error, { includeOrdinary: true });
    if (!workerError) {
      throw error;
    }
    return { ok: false, workerError };
  }
}

// Stdout carries only the JSON reply; raised console levels must not prefix it.
routeLogsToStderr();
process.stdout.write(JSON.stringify(inspect(process.argv[2])));
