import { afterEach, expect, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { isSessionStoreTopologyChange, sessionChanges } from "../sessions/session-row-changes.js";
import type { OmnipolymathAgentDatabaseRegistrationCommit } from "./omnipolymath-agent-db-contract.js";
import * as registryListing from "./omnipolymath-agent-db-registry-listing.js";
import {
  closeOmnipolymathAgentDatabasesAsync,
  closeOmnipolymathAgentDatabasesForTest,
  resolveOmnipolymathAgentSqlitePath,
} from "./omnipolymath-agent-db.js";
import {
  captureOmnipolymathStateDatabaseReadAdmission,
  closeOmnipolymathStateDatabaseAsync,
} from "./omnipolymath-state-db-cache.js";
import {
  closeOmnipolymathStateDatabaseForTest,
  openOmnipolymathStateDatabase,
} from "./omnipolymath-state-db.js";

export function useRegistrationFixture(beforeCleanup = () => {}) {
  const subscriptions = new Set<() => void>();
  const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
    afterEach(async () => {
      beforeCleanup();
      for (const stop of subscriptions) {
        stop();
      }
      subscriptions.clear();
      vi.restoreAllMocks();
      await closeOmnipolymathAgentDatabasesAsync();
      await closeOmnipolymathStateDatabaseAsync();
      closeOmnipolymathAgentDatabasesForTest();
      closeOmnipolymathStateDatabaseForTest();
      cleanup();
    }),
  );
  function createFixture(
    env = { OMNIPOLYMATH_STATE_DIR: tempDirs.make("omnipolymath-registration-commit-") },
  ) {
    const shared = openOmnipolymathStateDatabase({ env });
    const options = { agentId: "registration-commit", env };
    const target = { ...options, path: resolveOmnipolymathAgentSqlitePath(options) };
    const admission = captureOmnipolymathStateDatabaseReadAdmission(shared.path);
    const receipt: OmnipolymathAgentDatabaseRegistrationCommit = {
      agentId: target.agentId,
      agentPath: target.path,
      stateDatabasePath: shared.path,
      stateDatabaseIdentity: admission.identity.key,
    };
    const registrations = () => registryListing.readRegisteredAgentDatabases({ env }, false);
    const capture = (
      overrides: Partial<
        Parameters<typeof registryListing.captureOmnipolymathAgentDatabaseRegistration>[0]
      > = {},
    ) =>
      registryListing.captureOmnipolymathAgentDatabaseRegistration({
        agentId: target.agentId,
        agentPath: target.path,
        admission,
        ...overrides,
      });
    const entries = [expect.objectContaining({ agentId: target.agentId, path: target.path })];
    return { env, shared, target, admission, receipt, registrations, capture, entries };
  }
  function observeStores(database: ReturnType<typeof openOmnipolymathStateDatabase>) {
    const trace: Array<{ kind: "commit" | "stores"; inTransaction: boolean }> = [];
    const facts: boolean[] = [];
    subscriptions.add(
      sessionChanges.subscribeFacts((change) => {
        if (isSessionStoreTopologyChange(change)) {
          facts.push(registryListing.isOmnipolymathAgentDatabaseRegistryChange(change));
        }
      }),
    );
    const stop = sessionChanges.subscribe((change) => {
      if (isSessionStoreTopologyChange(change)) {
        trace.push({ kind: "stores", inTransaction: database.db.isTransaction });
      }
    });
    subscriptions.add(stop);
    return { trace, stop, facts };
  }
  return { createFixture, observeStores };
}
