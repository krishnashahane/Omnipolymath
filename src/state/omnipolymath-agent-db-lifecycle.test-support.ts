import { afterEach } from "vitest";
import { createTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  closeOmnipolymathAgentDatabasesAsync,
  closeOmnipolymathAgentDatabasesForTest,
} from "./omnipolymath-agent-db-lifecycle.js";
import {
  closeOmnipolymathStateDatabaseAsync,
  closeOmnipolymathStateDatabaseForTest,
} from "./omnipolymath-state-db.js";

/** Release callers before native handles, and native handles before their files. */
export function useAgentDatabaseDirectories(beforeClose: () => void | Promise<void> = () => {}) {
  const directories = createTempDirTracker();
  afterEach(async () => {
    await beforeClose();
    await closeOmnipolymathAgentDatabasesAsync();
    closeOmnipolymathAgentDatabasesForTest();
    await closeOmnipolymathStateDatabaseAsync();
    closeOmnipolymathStateDatabaseForTest();
    directories.cleanup();
  });
  return directories;
}
