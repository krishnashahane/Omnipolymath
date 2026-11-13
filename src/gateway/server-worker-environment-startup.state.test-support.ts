import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../config/runtime-snapshot.js";
import { closeOmnipolymathStateDatabaseByPathAsync } from "../state/omnipolymath-state-db.js";
import { resolveOmnipolymathStateSqlitePath } from "../state/omnipolymath-state-db.paths.js";
import { withEnvAsync } from "../test-utils/env.js";

export async function withGatewayWorkerEnvironmentStartupState<T>(
  stateDir: string,
  run: () => Promise<T>,
): Promise<T> {
  const databasePath = resolveOmnipolymathStateSqlitePath({ OMNIPOLYMATH_STATE_DIR: stateDir });
  return await withEnvAsync({ OMNIPOLYMATH_STATE_DIR: stateDir }, async () => {
    setRuntimeConfigSnapshot({});
    let result: T;
    try {
      result = await run();
    } catch (bodyError) {
      const [cleanup] = await Promise.allSettled([
        closeOmnipolymathStateDatabaseByPathAsync(databasePath),
      ]);
      if (cleanup.status === "rejected") {
        throw new AggregateError(
          [bodyError, cleanup.reason],
          "Worker environment startup fixture and database cleanup failed",
          { cause: bodyError },
        );
      }
      throw bodyError;
    }
    await closeOmnipolymathStateDatabaseByPathAsync(databasePath);
    return result;
  }).finally(clearRuntimeConfigSnapshot);
}
