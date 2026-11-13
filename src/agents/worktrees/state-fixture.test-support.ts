import { afterEach, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import {
  closeOmnipolymathStateDatabaseAsync,
  closeOmnipolymathStateDatabaseForTest,
} from "../../state/omnipolymath-state-db.js";

export function useWorktreeStateRoots(beforeReset?: () => void, afterClose?: () => void) {
  return useAutoCleanupTempDirTracker((cleanup) =>
    afterEach(async () => {
      beforeReset?.();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      vi.useRealTimers();
      await closeOmnipolymathStateDatabaseAsync();
      closeOmnipolymathStateDatabaseForTest();
      afterClose?.();
      cleanup();
    }),
  );
}
