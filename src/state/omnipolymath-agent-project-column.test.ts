import { afterEach, expect, test } from "vitest";
import { createOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";
import { OMNIPOLYMATH_AGENT_SCHEMA_VERSION } from "./omnipolymath-agent-db-contract.js";
import {
  closeOmnipolymathAgentDatabasesForTest,
  openOmnipolymathAgentDatabase,
} from "./omnipolymath-agent-db.js";
import { closeOmnipolymathStateDatabaseForTest } from "./omnipolymath-state-db.js";

afterEach(() => {
  closeOmnipolymathAgentDatabasesForTest();
  closeOmnipolymathStateDatabaseForTest();
});

test("current-version agent databases lazily add the nullable project column", async () => {
  const state = await createOmnipolymathTestState({ layout: "state-only", prefix: "agent-project-" });
  try {
    const options = { agentId: "main", env: state.env };
    const initial = openOmnipolymathAgentDatabase(options);
    initial.db.exec("ALTER TABLE session_nodes DROP COLUMN project_id;");
    initial.db
      .prepare(
        `INSERT INTO session_nodes
          (session_key, current_session_id, entry_json, entry_valid, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        "agent:main:old-shape",
        "session-old-shape",
        JSON.stringify({ sessionId: "session-old-shape", updatedAt: 1 }),
        1,
        1,
      );
    closeOmnipolymathAgentDatabasesForTest();

    const reopened = openOmnipolymathAgentDatabase(options);
    const columns = reopened.db.prepare("PRAGMA table_info(session_nodes)").all() as Array<{
      name: string;
      notnull: number;
      type: string;
    }>;
    expect(columns.find((column) => column.name === "project_id")).toMatchObject({
      type: "TEXT",
      notnull: 0,
    });
    expect(reopened.db.prepare("PRAGMA user_version").get()?.user_version).toBe(
      OMNIPOLYMATH_AGENT_SCHEMA_VERSION,
    );
    expect(
      reopened.db
        .prepare("SELECT project_id FROM session_nodes WHERE session_key = ?")
        .get("agent:main:old-shape"),
    ).toEqual({ project_id: null });
  } finally {
    await state.cleanup();
  }
});
