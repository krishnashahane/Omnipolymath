import { vi } from "vitest";
import { closeOmnipolymathStateDatabaseForTest } from "../../state/omnipolymath-state-db.js";

export function cleanupUpdateCommandTest() {
  closeOmnipolymathStateDatabaseForTest();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
}
