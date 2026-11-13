// Omnipolymath audit tests cover SQLite-backed rescue audit scenarios.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as sqliteQueries from "../infra/kysely-sync.js";
import {
  closeOmnipolymathStateDatabaseAsync,
  openOmnipolymathStateDatabase,
} from "../state/omnipolymath-state-db.js";
import { withTestDir } from "../test-helpers/temp-dir.js";
import { appendSystemAgentAuditEntry, SYSTEM_AGENT_AUDIT_STORE_LABEL } from "./audit.js";
import { listSystemAgentAuditEntriesForTests } from "./audit.test-support.js";

describe("Omnipolymath audit log", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await closeOmnipolymathStateDatabaseAsync();
  });

  it("writes records into shared SQLite state", async () => {
    await withTestDir({ prefix: "omnipolymath-audit-" }, async (tempDir) => {
      vi.stubEnv("OMNIPOLYMATH_STATE_DIR", tempDir);
      openOmnipolymathStateDatabase();
      const queries = vi.spyOn(sqliteQueries, "executeSqliteQuerySync");
      const singleQueries = vi.spyOn(sqliteQueries, "executeSqliteQueryTakeFirstSync");

      const auditStore = await appendSystemAgentAuditEntry({
        operation: "config.setDefaultModel",
        summary: "Set default model to openai/gpt-5.2",
        configHashBefore: "before",
        configHashAfter: "after",
      });

      expect(auditStore).toBe(SYSTEM_AGENT_AUDIT_STORE_LABEL);
      expect(queries).not.toHaveBeenCalled();
      expect(singleQueries).not.toHaveBeenCalled();
      const records = listSystemAgentAuditEntriesForTests();
      expect(records).toHaveLength(1);
      const entry = records[0]?.value;
      expect(entry).toBeDefined();
      if (!entry) {
        throw new Error("expected persisted system-agent audit entry");
      }
      expect(entry.operation).toBe("config.setDefaultModel");
      expect(entry.summary).toBe("Set default model to openai/gpt-5.2");
      expect(entry.configHashBefore).toBe("before");
      expect(entry.configHashAfter).toBe("after");
    });
  });
});
