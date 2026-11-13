import { afterEach, beforeEach, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../../test/helpers/temp-dir.js";
import { resolvePreferredOmnipolymathTmpDir } from "../../../infra/tmp-omnipolymath-dir.js";
import {
  closeOmnipolymathStateDatabaseAsync,
  closeOmnipolymathStateDatabaseForTest,
  openOmnipolymathStateDatabase,
  type OmnipolymathStateDatabase,
} from "../../../state/omnipolymath-state-db.js";
import { subagentRuns } from "../registry/subagent-registry-memory.js";
import { admitCompletionFixtureDatabase } from "./subagent-completion-admission.test-helpers.js";

export function useCompletionDatabase(prefix: string, closed?: () => void) {
  let database: OmnipolymathStateDatabase;
  const tempDirs = useAutoCleanupTempDirTracker(afterEach);
  beforeEach(async () => {
    vi.stubEnv("OMNIPOLYMATH_STATE_DIR", tempDirs.make(prefix, resolvePreferredOmnipolymathTmpDir()));
    database = openOmnipolymathStateDatabase();
    await admitCompletionFixtureDatabase();
  });
  afterEach(async () => {
    await closeOmnipolymathStateDatabaseAsync();
    closed?.();
    subagentRuns.clear();
    closeOmnipolymathStateDatabaseForTest();
    vi.unstubAllEnvs();
  });
  return {
    get value() {
      return database;
    },
    set value(opened: OmnipolymathStateDatabase) {
      database = opened;
    },
  };
}
