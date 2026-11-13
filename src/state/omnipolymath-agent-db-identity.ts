import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { sqlPublicationAnchor, type EngineConnection } from "../infra/sql-connection.js";
import { getSqliteDatabaseAdmissionIdentityForPath } from "../infra/sqlite-database-admission.js";
import {
  normalizeDatabasePath,
  readDatabasePathIdentitySync,
  resolveDatabasePathKey,
  type DatabaseFileIdentity,
} from "../infra/sqlite-worker-identity.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";

type AgentDatabaseOwner = { db: EngineConnection };
export type OmnipolymathAgentDatabaseIdentity = string;

const identities = resolveGlobalSingleton(
  Symbol.for("omnipolymath.agentDatabaseIdentities"),
  () =>
    new WeakMap<
      DatabaseSync,
      {
        identity: OmnipolymathAgentDatabaseIdentity;
        birthtime: string | undefined;
        incarnation: string;
        filename: string;
        canonicalPath: string;
        ownerDatabasePath?: string;
      }
    >(),
);

/** Prepare physical and connection identity once at open; cached aliases are not resolved again. */
export function registerOmnipolymathAgentDatabaseIdentity(
  db: EngineConnection,
  ownerDatabasePath?: string,
): void {
  const anchor = sqlPublicationAnchor(db);
  const filename = normalizeDatabasePath(anchor.location() ?? "");
  const admitted = filename ? getSqliteDatabaseAdmissionIdentityForPath(filename) : undefined;
  const file = admitted
    ? { ...admitted, canonicalPath: resolveDatabasePathKey(filename) }
    : filename
      ? readDatabasePathIdentitySync(filename)
      : undefined;
  if (!file || !file.key.startsWith("file:")) {
    throw new Error("Omnipolymath agent database requires a physical file for identity registration");
  }
  const identity = file.key.slice("file:".length);
  identities.set(anchor, {
    identity,
    birthtime: file.birthtime,
    incarnation: randomUUID(),
    filename,
    canonicalPath: file.canonicalPath,
    ownerDatabasePath: ownerDatabasePath ? resolveDatabasePathKey(ownerDatabasePath) : undefined,
  });
}

/** Reuse facts captured at open; aliases must never be resolved again at a handoff. */
export function readOmnipolymathAgentDatabaseIdentity(database: AgentDatabaseOwner) {
  const prepared = findOmnipolymathAgentDatabaseIdentity(database);
  if (prepared === undefined) {
    throw new Error("Omnipolymath agent database identity was not prepared at open");
  }
  return prepared;
}

/** Raw diagnostic connections have no admitted physical identity. */
export function findOmnipolymathAgentDatabaseIdentity(database: AgentDatabaseOwner) {
  return identities.get(sqlPublicationAnchor(database.db));
}

/** A retained connection can outlive its pathname or be deserialized away from that file. */
export function isOmnipolymathAgentDatabasePathCurrent(
  database: AgentDatabaseOwner & { path: string },
): boolean {
  const anchor = sqlPublicationAnchor(database.db);
  if (!database.db.isOpen || !anchor.isOpen) {
    return false;
  }
  const { identity, filename } = readOmnipolymathAgentDatabaseIdentity(database);
  if (normalizeDatabasePath(anchor.location() ?? "") !== filename) {
    return false;
  }
  const current = statSync(database.path, { bigint: true, throwIfNoEntry: false });
  return current !== undefined && identity === `${current.dev}:${current.ino}`;
}

export function assertOmnipolymathAgentDatabaseIdentity(
  database: AgentDatabaseOwner & { path: string },
  expected: DatabaseFileIdentity,
): void {
  const identity = readOmnipolymathAgentDatabaseIdentity(database);
  if (
    `file:${identity.identity}` !== expected.key ||
    (expected.birthtime !== undefined && identity.birthtime !== expected.birthtime) ||
    !isOmnipolymathAgentDatabasePathCurrent(database)
  ) {
    throw new Error("Agent database changed during repair admission");
  }
}

export type OmnipolymathAgentDatabaseClaim = ReturnType<typeof createOmnipolymathAgentDatabaseClaim>;

export function createOmnipolymathAgentDatabaseClaim(
  database: AgentDatabaseOwner,
  release: () => void,
) {
  let released = false;
  const isCurrent = () =>
    !released && database.db.isOpen && sqlPublicationAnchor(database.db).isOpen;
  const { identity, incarnation } = readOmnipolymathAgentDatabaseIdentity(database);
  return {
    identity,
    // Changes on reopen even when the underlying file is unchanged.
    incarnation,
    isCurrent,
    assertCurrent: () => {
      if (!isCurrent()) {
        throw new Error("Omnipolymath agent database claim is no longer current");
      }
    },
    release: () => {
      if (!released) {
        released = true;
        release();
      }
    },
  };
}
