import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { configureMockSubagentRegistryPersistence } from "../agents/subagent-test-fixtures.test-helpers.js";
import {
  addSubagentRunForTests,
  resetSubagentRegistryForTests,
} from "../agents/subagents/registry/subagent-registry.test-helpers.js";
import { consumeSwarmStructuredOutput } from "../agents/tools/structured-output-tool.js";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../config/runtime-snapshot.js";
import {
  createOmnipolymathTestState,
  type OmnipolymathTestState,
} from "../test-utils/omnipolymath-test-state.js";

export function useMcpCollectorRegistry(
  entry: Pick<
    Parameters<typeof addSubagentRunForTests>[0],
    "runId" | "childSessionKey" | "outputSchema"
  >,
) {
  let state: OmnipolymathTestState;
  beforeAll(async () => {
    state = await createOmnipolymathTestState({
      prefix: "omnipolymath-mcp-collector-registry-",
      layout: "state-only",
    });
  });
  beforeEach(async () => {
    setRuntimeConfigSnapshot({});
    await resetSubagentRegistryForTests({ persist: false });
    await configureMockSubagentRegistryPersistence({ persistRegistryRows: () => {} });
    await addSubagentRunForTests({ ...entry, collect: true });
  });
  afterEach(async () => {
    consumeSwarmStructuredOutput(entry.runId);
    await resetSubagentRegistryForTests();
    clearRuntimeConfigSnapshot();
  });
  afterAll(async () => {
    await state.cleanup();
  });
}
