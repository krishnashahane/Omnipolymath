import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as boundaryPath from "../infra/boundary-path.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import { mockProcessPlatform } from "../test-utils/vitest-spies.js";
import {
  reconstructAgentDeletionJournal,
  resolveAgentDeletionRecoveryHolds,
} from "./agent-deletion-journal-recovery.js";
import { readAgentDeletionMissingJournalHolds } from "./agent-deletion-journal-recovery.kernel.js";
import {
  resolveOmnipolymathAgentDatabaseStoredPath,
  resolveOmnipolymathRegisteredAgentDatabasePath,
} from "./omnipolymath-state-db.paths.js";
import { OMNIPOLYMATH_STATE_SCHEMA_SQL } from "./omnipolymath-state-schema.js";

vi.hoisted(() => {
  // The custody runner can preload these owners before the Windows path mock.
  vi.resetModules();
});

vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:path")>();
  return { ...actual, default: actual.win32 };
});

beforeEach(() => {
  mockProcessPlatform("win32");
  // These locators are synthetic; canonical-root cases supply their own observed root.
  vi.spyOn(boundaryPath, "resolveIdentityPathViaExistingAncestorSync").mockImplementation(
    (root) => root,
  );
});
afterEach(() => vi.restoreAllMocks());

it.each([
  [String.raw`\\kost\share\Omnipolymath`, String.raw`\\Kost\share\Omnipolymath\agents\main\agent.sqlite`],
  [
    String.raw`\\server\share\Omnipolymath`,
    String.raw`\\?\UNC\server\share\..\..\server\share\Omnipolymath\agent.sqlite`,
  ],
  [String.raw`C:\Omnipolymath`, String.raw`\\.\C:\..\UNC\server\share\agent.sqlite`],
  [
    String.raw`C:\Omnipolymath`,
    String.raw`\\?\Volume{00000000-0000-0000-0000-000000000001}\agent.sqlite`,
  ],
])("retains raw locator identity under %s for %s", (stateDir, agentPath) => {
  vi.spyOn(boundaryPath, "resolveIdentityPathViaExistingAncestorSync").mockImplementation(
    (root) => {
      expect(root, "only the trusted state root may be probed").toBe(stateDir);
      return stateDir;
    },
  );
  const registry = path.join(stateDir, "state", "omnipolymath.sqlite");
  const stored = resolveOmnipolymathAgentDatabaseStoredPath(registry, agentPath);
  expect(stored).toBe(agentPath);
  expect(resolveOmnipolymathRegisteredAgentDatabasePath(registry, stored)).toBe(agentPath);
});

it("relativizes an admitted path under its canonical root", () => {
  const canonicalRoot = String.raw`D:\Canonical`;
  const relative = String.raw`linked\..\agent.sqlite`;
  const registry = String.raw`C:\Alias\state\omnipolymath.sqlite`;
  const resolveRoot = vi.spyOn(boundaryPath, "resolveIdentityPathViaExistingAncestorSync");
  for (const root of [canonicalRoot, path.toNamespacedPath(canonicalRoot)]) {
    resolveRoot.mockReturnValue(root);
    for (const sourceRoot of [canonicalRoot, path.toNamespacedPath(canonicalRoot)]) {
      const candidate = `${sourceRoot}\\${relative}`;
      expect(resolveOmnipolymathAgentDatabaseStoredPath(registry, candidate)).toBe(relative);
    }
  }
});

it("preserves and releases reconstructed holds with Windows registry paths", () => {
  using db = new DatabaseSync(":memory:");
  db.exec(OMNIPOLYMATH_STATE_SCHEMA_SQL);
  db.exec("DROP TABLE agent_deletion_journal");
  const database = { db, path: String.raw`C:\Users\operator\.omnipolymath\state\omnipolymath.sqlite` };
  const held = ["main", "ayudante", "contador"].map((agentId) => ({
    agentId,
    path: `C:\\Users\\operator\\.omnipolymath\\agents\\${agentId}\\agent\\omnipolymath-agent.sqlite`,
  }));
  runSqliteImmediateTransactionSync(db, () => reconstructAgentDeletionJournal(database, held));
  expect(readAgentDeletionMissingJournalHolds(database)).toEqual(held);
  runSqliteImmediateTransactionSync(db, () =>
    resolveAgentDeletionRecoveryHolds(database, "main", [held[0]!.path]),
  );
  expect(readAgentDeletionMissingJournalHolds(database)).toEqual(held.slice(1));
});
