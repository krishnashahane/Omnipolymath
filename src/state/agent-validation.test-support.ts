import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isPostgresSqlConnection } from "../infra/sql-connection.js";
import { withOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";
import type {
  OmnipolymathAgentDatabase,
  OmnipolymathAgentDatabaseOptions,
} from "./omnipolymath-agent-db-contract.js";
import {
  getOmnipolymathAgentDatabaseValidation,
  invalidateOmnipolymathAgentDatabaseValidation,
} from "./omnipolymath-agent-db-validation-cache.js";
import {
  closeOmnipolymathAgentDatabaseByPath,
  openOmnipolymathAgentDatabase,
} from "./omnipolymath-agent-db.js";

type NativeAgentDatabase = OmnipolymathAgentDatabase & { db: DatabaseSync };

function assertNativeAgentDatabase(
  database: OmnipolymathAgentDatabase,
): asserts database is NativeAgentDatabase {
  if (isPostgresSqlConnection(database.db)) {
    throw new Error("Native validation fixture requires SQLite");
  }
}

export async function withReceiptFixture(
  populated: boolean,
  run: (
    database: NativeAgentDatabase,
    options: OmnipolymathAgentDatabaseOptions,
  ) => void | Promise<void>,
) {
  await withOmnipolymathTestState({ scenario: "minimal" }, async ({ env }) => {
    const options = { agentId: "main", env };
    let database = openOmnipolymathAgentDatabase(options);
    assertNativeAgentDatabase(database);
    if (populated) {
      database.db.exec(`INSERT INTO session_nodes
        (session_key, current_session_id, entry_json, updated_at)
        VALUES ('agent:main:existing', 'existing', '{"sessionId":"existing","updatedAt":1}', 1);
        UPDATE session_nodes SET entry_valid = 1;
        DELETE FROM session_canonical_validation_pending;`);
      invalidateOmnipolymathAgentDatabaseValidation(database.path);
      closeOmnipolymathAgentDatabaseByPath(database.path);
      database = openOmnipolymathAgentDatabase(options);
      assertNativeAgentDatabase(database);
    }
    await run(database, options);
  });
}

export function independentWorkerReceipt(database: OmnipolymathAgentDatabase) {
  const receipt = getOmnipolymathAgentDatabaseValidation(database);
  if (!receipt) {
    throw new Error("Expected physical validation receipt");
  }
  // A native first opener can establish proof before the host has any receipt.
  return {
    ...receipt,
    receiptId: randomUUID(),
    valid: receipt.valid.slice(0),
    canonicalReady: receipt.canonicalReady.slice(0),
  };
}
