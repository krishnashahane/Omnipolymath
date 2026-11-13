import path from "node:path";
import { statIfExists } from "../infra/path-existence.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { OmnipolymathStateDatabaseOptions } from "../state/omnipolymath-state-db.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import type { ProjectRegistryIdentity } from "./project-registry.types.js";

const log = createSubsystemLogger("projects/clone-history");

/** History recovery is operator-owned: an unshallow can occupy the checkout lease for minutes. */
export async function warnIfProjectCloneShallow(
  repoRoot: string,
  options: Pick<OmnipolymathStateDatabaseOptions, "path" | "env"> & {
    commonDir?: string;
    source?: ProjectRegistryIdentity["source"];
  },
): Promise<void> {
  if (options.source && options.source !== "cloned") {
    return;
  }
  try {
    if (
      !(await statIfExists(path.join(options.commonDir ?? path.join(repoRoot, ".git"), "shallow")))
    ) {
      return;
    }
    if (!options.source) {
      const context = captureOmnipolymathStateWorkerContext(options);
      const { executeOmnipolymathStateWorker } =
        await import("../state/omnipolymath-state-worker-store.js");
      if (
        !(await executeOmnipolymathStateWorker(context, {
          type: "projects.findRoot",
          input: { repoRoot, source: "cloned" },
        }))
      ) {
        return;
      }
    }
    log.warn(
      `Managed project clone ${repoRoot} has shallow history; continuing without repair. Run omnipolymath doctor --fix during a maintenance window to restore full history while retaining blob:none.`,
    );
  } catch (error) {
    // A diagnostic must not turn an otherwise usable checkout into a failed user turn.
    log.warn(
      `Could not inspect clone history at ${repoRoot}; continuing. Run omnipolymath doctor to diagnose.`,
      { error: String(error) },
    );
  }
}
