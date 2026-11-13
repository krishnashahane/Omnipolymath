import { expect, it, vi } from "vitest";
import * as sqlite from "../infra/node-sqlite.js";
import type { EngineConnection } from "../infra/sql-connection.js";
import { withOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";
import { withFreshOmnipolymathAgentDatabaseReadOnly } from "./omnipolymath-agent-db-readonly-open.js";
import { withOmnipolymathAgentDatabaseReadOnly } from "./omnipolymath-agent-db-readonly.js";
import {
  closeOmnipolymathAgentDatabaseByPath,
  openOmnipolymathAgentDatabase,
} from "./omnipolymath-agent-db.js";

it("preserves programming failures when required tables remain available", async () => {
  await withOmnipolymathTestState({ scenario: "minimal" }, async (state) => {
    const options = { agentId: "main", env: state.env };
    openOmnipolymathAgentDatabase(options);
    const failure = new TypeError("invalid reader operation");
    expect(() =>
      withOmnipolymathAgentDatabaseReadOnly(() => {
        throw failure;
      }, options),
    ).toThrow(failure);
    expect(() =>
      withOmnipolymathAgentDatabaseReadOnly(
        ({ db }) => db.prepare("SELECT * FROM missing_readonly_table").all(),
        options,
      ),
    ).toThrow(/no such table: missing_readonly_table/);
  });
});

it.each([false, true])(
  "classifies missing tables before and after close (%s)",
  async (freshOnly) => {
    await withOmnipolymathTestState({ scenario: "minimal" }, async (state) => {
      const options = { agentId: "main", env: state.env };
      const owner = openOmnipolymathAgentDatabase(options);
      owner.db.exec("DROP TABLE session_canonical_validation_pending;");
      let readDb: EngineConnection = owner.db;
      const nativeOpen = sqlite.openNodeSqliteDatabase;
      const open = vi.spyOn(sqlite, "openNodeSqliteDatabase").mockImplementation((...args) => {
        const database = nativeOpen(...args);
        if (args[0] === owner.path) {
          readDb = database;
        }
        return database;
      });
      const readOnly = freshOnly
        ? withFreshOmnipolymathAgentDatabaseReadOnly
        : withOmnipolymathAgentDatabaseReadOnly;
      const operation = vi.fn(({ db }: { db: EngineConnection }) =>
        db.prepare("SELECT * FROM session_canonical_validation_pending").all(),
      );
      const read = () => readOnly(operation, options);
      const unavailable = {
        name: "SessionMetadataUnavailableError",
        reason: "table-missing",
        missingTables: ["session_canonical_validation_pending"],
      };
      const coldCause = /canonical validation schema is missing or drifted.*omnipolymath doctor --fix/u;

      try {
        expect(read).toThrow(
          expect.objectContaining({
            ...unavailable,
            cause: expect.objectContaining({
              message: expect.stringMatching(coldCause),
            }),
          }),
        );
        expect(operation).not.toHaveBeenCalled();
        expect(readDb === owner.db).toBe(!freshOnly);
        expect(readDb.isOpen).toBe(!freshOnly);
        expect(owner.db.isOpen).toBe(true);
        expect(closeOmnipolymathAgentDatabaseByPath(owner.path)).toBe(true);
        expect(read).toThrow(
          expect.objectContaining({
            ...unavailable,
            cause: expect.objectContaining({ message: expect.stringMatching(coldCause) }),
          }),
        );
        expect(operation).not.toHaveBeenCalled();
        expect(readDb.isOpen).toBe(false);
      } finally {
        open.mockRestore();
      }
    });
  },
);
