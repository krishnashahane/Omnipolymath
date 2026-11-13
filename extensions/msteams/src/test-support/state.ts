import { resetPluginStateStoreForTests } from "omnipolymath/plugin-sdk/plugin-state-test-runtime";
import { closeOmnipolymathStateDatabaseAsync } from "omnipolymath/plugin-sdk/sqlite-runtime-testing";
import { useAutoCleanupTempDirTracker } from "omnipolymath/plugin-sdk/test-env";
import { afterAll } from "vitest";

export function useMSTeamsStateTempDirs() {
  return useAutoCleanupTempDirTracker((cleanup) =>
    afterAll(async () => {
      await closeOmnipolymathStateDatabaseAsync();
      resetPluginStateStoreForTests();
      cleanup();
    }),
  );
}
