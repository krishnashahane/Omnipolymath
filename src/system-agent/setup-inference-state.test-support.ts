import { vi } from "vitest";
import { clearConfigCache } from "../config/config.js";
import { closeOmnipolymathAgentDatabasesForTest } from "../state/omnipolymath-agent-db.js";
import {
  closeOmnipolymathStateDatabaseAsync,
  closeOmnipolymathStateDatabaseForTest,
} from "../state/omnipolymath-state-db.js";
import { tempDirs } from "./setup-inference-activate.test-support.js";

export async function resetSetupInferenceState() {
  closeOmnipolymathAgentDatabasesForTest();
  await closeOmnipolymathStateDatabaseAsync();
  closeOmnipolymathStateDatabaseForTest();
  tempDirs.cleanup();
  clearConfigCache();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
}
