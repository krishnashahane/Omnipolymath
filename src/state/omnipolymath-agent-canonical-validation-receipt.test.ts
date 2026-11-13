import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { runNodeScript } from "../../test/helpers/run-node-script.js";
import { resolveRuntimeWorkerUrl } from "../infra/runtime-worker-url.js";
import { withOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";
import { stateNativeProcessEntrypoints } from "./native-process-runtime.test-support.js";
import {
  hasPersistedOmnipolymathAgentCanonicalValidation,
  recordOmnipolymathAgentCanonicalValidation,
} from "./omnipolymath-agent-canonical-validation-receipt.js";
import {
  openOmnipolymathAgentDatabase,
  runOmnipolymathAgentWriteTransaction,
} from "./omnipolymath-agent-db.js";

it("requires admitted physical identity and write admission for persisted canonical receipts", async () => {
  await withOmnipolymathTestState({ scenario: "minimal" }, async ({ env }) => {
    const options = { agentId: "main", env };
    const database = openOmnipolymathAgentDatabase(options);
    runOmnipolymathAgentWriteTransaction(recordOmnipolymathAgentCanonicalValidation, options);
    const raw = new DatabaseSync(database.path, { readOnly: true });
    try {
      expect(hasPersistedOmnipolymathAgentCanonicalValidation({ db: raw, agentId: "main" })).toBe(
        false,
      );
      expect(hasPersistedOmnipolymathAgentCanonicalValidation({ ...database, agentId: "other" })).toBe(
        false,
      );
      expect(() => recordOmnipolymathAgentCanonicalValidation(database)).toThrow("write admission");
    } finally {
      raw.close();
    }
  });
});

it("preserves legacy receipts and shares committed canonical proof with admitted readers", async () => {
  const result = await runNodeScript(
    (workerArgv) =>
      workerArgv(resolveRuntimeWorkerUrl(stateNativeProcessEntrypoints.canonicalReceipt)),
    process.env,
    undefined,
  );
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
});
