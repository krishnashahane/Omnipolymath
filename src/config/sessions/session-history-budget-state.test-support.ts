import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { resetAgentRunRegistryForTest } from "../../infra/agent-run-registry.js";
import * as tmpDirOwner from "../../infra/tmp-omnipolymath-dir.js";
import {
  closeOmnipolymathAgentDatabasesAsync,
  closeOmnipolymathAgentDatabasesForTest,
} from "../../state/omnipolymath-agent-db.js";
import {
  createOmnipolymathTestState,
  type OmnipolymathTestState,
} from "../../test-utils/omnipolymath-test-state.js";
import { enforceSqliteSessionHistoryDiskBudget } from "./session-history-eviction.js";

export function installHistoryBudgetState(
  prefix: string,
  setup: (state: OmnipolymathTestState, tempDir: string, storePath: string) => void,
  overrideTmp = true,
) {
  let state: OmnipolymathTestState;
  let storePath: string;
  beforeEach(async () => {
    state = await createOmnipolymathTestState({ prefix, layout: "state-only" });
    if (overrideTmp) {
      vi.spyOn(tmpDirOwner, "resolvePreferredOmnipolymathTmpDir").mockReturnValue(state.root);
    }
    const tempDir = state.sessionsDir();
    fs.mkdirSync(tempDir, { recursive: true });
    storePath = path.join(tempDir, "sessions.json");
    setup(state, tempDir, storePath);
  });
  afterEach(async () => {
    resetAgentRunRegistryForTest();
    vi.restoreAllMocks();
    await enforceSqliteSessionHistoryDiskBudget({
      storePath,
      mode: "warn",
      maintenance: { maxDiskBytes: null, highWaterBytes: null },
    });
    await closeOmnipolymathAgentDatabasesAsync();
    closeOmnipolymathAgentDatabasesForTest();
    await state.cleanup();
  });
}
