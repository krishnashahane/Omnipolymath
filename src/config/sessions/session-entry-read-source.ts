import {
  assertExistingDatabaseIdentity,
  type DatabasePathIdentity,
} from "../../infra/sqlite-worker-identity.js";
import type { OmnipolymathAgentDatabase } from "../../state/omnipolymath-agent-db-contract.js";
import {
  assertOmnipolymathAgentDatabaseIdentity,
  isOmnipolymathAgentDatabasePathCurrent,
  readOmnipolymathAgentDatabaseIdentity,
} from "../../state/omnipolymath-agent-db-identity.js";
import type { CapturedSessionEntryReadSource } from "./session-entry-read-source.types.js";

export function captureSessionEntryReadSource(
  database: Pick<OmnipolymathAgentDatabase, "agentId" | "db" | "path">,
  expectedIdentity: DatabasePathIdentity | undefined,
  unavailableMessage = "Session entry read requires its current durable owner",
) {
  if (expectedIdentity) {
    assertOmnipolymathAgentDatabaseIdentity(database, expectedIdentity);
  }
  const identity = readOmnipolymathAgentDatabaseIdentity(database);
  if (typeof identity.identity !== "string" || !isOmnipolymathAgentDatabasePathCurrent(database)) {
    throw new Error(unavailableMessage);
  }
  return {
    agentId: database.agentId,
    path: database.path,
    databaseIdentity: identity.identity,
    databaseBirthtime: identity.birthtime,
  };
}

export function assertCapturedSessionEntryReadSource(
  source: CapturedSessionEntryReadSource,
  database?: Pick<OmnipolymathAgentDatabase, "agentId" | "path" | "db">,
): void {
  if (typeof source.databaseIdentity === "string" && (!database || database.path !== source.path)) {
    assertExistingDatabaseIdentity(
      source.path,
      `file:${source.databaseIdentity}`,
      source.databaseBirthtime,
    );
  }
  if (!database) {
    if (typeof source.databaseIdentity === "symbol") {
      throw new Error("Captured session database is no longer open");
    }
    return;
  }
  const physical = readOmnipolymathAgentDatabaseIdentity(database);
  if (
    database.agentId !== source.agentId ||
    physical.identity !== source.databaseIdentity ||
    physical.birthtime !== source.databaseBirthtime ||
    !isOmnipolymathAgentDatabasePathCurrent(database)
  ) {
    throw new Error("Captured session database changed before read");
  }
}
