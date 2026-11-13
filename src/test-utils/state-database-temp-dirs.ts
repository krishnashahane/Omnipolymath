import { afterEach, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  closeOmnipolymathStateDatabaseAsync,
  closeOmnipolymathStateDatabaseForTest,
} from "../state/omnipolymath-state-db.js";

export function useStateDatabaseTempDirs() {
  return useAutoCleanupTempDirTracker((cleanup) =>
    afterEach(async () => {
      vi.restoreAllMocks();
      await closeOmnipolymathStateDatabaseAsync();
      closeOmnipolymathStateDatabaseForTest();
      cleanup();
    }),
  );
}
