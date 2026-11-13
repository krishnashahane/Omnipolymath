import { existsSync, realpathSync } from "node:fs";
import nodePath from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { formatErrorMessage } from "../infra/errors.js";
import { openNodeSqliteDatabase, resolveImmutableSqliteFileUri } from "../infra/node-sqlite.js";
import { setSqliteBusyTimeout } from "../infra/sqlite-busy-timeout.js";
import { assertSqliteIntegrity } from "../infra/sqlite-integrity.js";
import type { SqliteSchemaIssue } from "../infra/sqlite-schema-contract.js";
import {
  createNewerSqliteSchemaVersionError,
  readSqliteUserVersion,
  readSqliteWriterAppVersion,
} from "../infra/sqlite-user-version.js";
import { configureSqliteReadOnlyPragmas } from "../infra/sqlite-wal.js";
import { describeDeferredStateSchemaPublication } from "./omnipolymath-database-preflight.messages.js";
import type {
  DeferredStateSchemaPublication,
  OmnipolymathStateSchemaPreflightResult,
} from "./omnipolymath-database-preflight.types.js";
import {
  OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS,
  OMNIPOLYMATH_STATE_SCHEMA_VERSION,
} from "./omnipolymath-state-db-contract.js";
import { assertNoLegacyStateRuntimeRepair } from "./omnipolymath-state-db-fast-path.js";
import { readStateSchemaContentVersion } from "./omnipolymath-state-db-schema-version.js";
import {
  inspectOmnipolymathStateOwnershipFromDatabase,
  type OmnipolymathExternalStateOwnership,
} from "./omnipolymath-state-ownership.js";
import { inspectCurrentStateStartupSchema } from "./omnipolymath-state-schema-inspection.js";
import { readStateSchemaPublicationBlocker } from "./omnipolymath-state-schema-publication.js";

/** Compare one explicit SQLite file with this release's canonical shared-state schema. */
export async function preflightOmnipolymathStateDatabasePath(
  databasePath: string,
): Promise<OmnipolymathStateSchemaPreflightResult> {
  const resolvedPath = nodePath.resolve(databasePath);
  const base = {
    schema: "omnipolymath.state-schema-preflight.v1",
    databasePath: resolvedPath,
    targetVersion: OMNIPOLYMATH_STATE_SCHEMA_VERSION,
  } as const;
  let database: DatabaseSync | undefined;
  let foundVersion: number | null = null;
  let contentVersion: number | undefined;
  let deferredPublication: DeferredStateSchemaPublication | undefined;
  let ownership: OmnipolymathExternalStateOwnership | null = null;
  const result = (
    status: OmnipolymathStateSchemaPreflightResult["status"],
    details: { issues?: SqliteSchemaIssue[]; reason?: string; requiresWrite?: boolean } = {},
  ): OmnipolymathStateSchemaPreflightResult => ({
    ...base,
    foundVersion,
    ...(contentVersion !== undefined && contentVersion !== foundVersion ? { contentVersion } : {}),
    ...(deferredPublication ? { deferredPublication } : {}),
    ownership,
    issues: details.issues ?? [],
    status,
    requiresWrite: details.requiresWrite ?? false,
    ...(details.reason ? { reason: details.reason } : {}),
  });
  try {
    const inspectionPath = realpathSync.native(resolvedPath);
    const sidecars = ["-wal", "-shm", "-journal"].filter((suffix) =>
      existsSync(`${inspectionPath}${suffix}`),
    );
    if (sidecars.length > 0) {
      throw new Error(
        `SQLite preflight requires a consolidated snapshot with no sidecars; found ${sidecars.join(", ")}. Create a WAL-aware online backup and preflight the resulting standalone file.`,
      );
    }
    database = openNodeSqliteDatabase(resolveImmutableSqliteFileUri(inspectionPath), {
      readOnly: true,
    });
    setSqliteBusyTimeout(database, OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS);
    configureSqliteReadOnlyPragmas(database);
    foundVersion = readSqliteUserVersion(database);
    if (!Number.isSafeInteger(foundVersion) || foundVersion < 0) {
      throw new Error(
        `Omnipolymath state database ${resolvedPath} has invalid schema version metadata.`,
      );
    }
    contentVersion =
      foundVersion > OMNIPOLYMATH_STATE_SCHEMA_VERSION
        ? foundVersion
        : readStateSchemaContentVersion(database);
    if (contentVersion > OMNIPOLYMATH_STATE_SCHEMA_VERSION) {
      try {
        ownership = inspectOmnipolymathStateOwnershipFromDatabase(database, resolvedPath);
      } catch {
        // A newer release can own a newer metadata contract; the numeric refusal remains decisive.
      }
      return result("incompatible", {
        reason: createNewerSqliteSchemaVersionError(
          "Omnipolymath state database",
          resolvedPath,
          contentVersion,
          OMNIPOLYMATH_STATE_SCHEMA_VERSION,
          readSqliteWriterAppVersion(database),
        ).message,
      });
    }
    assertSqliteIntegrity(database, resolvedPath);
    ownership = inspectOmnipolymathStateOwnershipFromDatabase(database, resolvedPath);
    if (readStateSchemaContentVersion(database) < OMNIPOLYMATH_STATE_SCHEMA_VERSION) {
      return result("migration-required", { requiresWrite: true });
    }
    if (foundVersion < contentVersion) {
      deferredPublication = describeDeferredStateSchemaPublication(
        readStateSchemaPublicationBlocker(database),
        resolvedPath,
        foundVersion,
        contentVersion,
      );
    }
    const { blockingIssues, startupRepairableIssues } = inspectCurrentStateStartupSchema(
      database,
      resolvedPath,
      foundVersion,
    );
    if (blockingIssues.length > 0) {
      return result("incompatible", { issues: blockingIssues });
    }
    assertNoLegacyStateRuntimeRepair(database, resolvedPath);
    return result(startupRepairableIssues.length > 0 ? "startup-repairable" : "exact", {
      issues: startupRepairableIssues,
      requiresWrite: startupRepairableIssues.length > 0,
    });
  } catch (error) {
    return result("indeterminate", { reason: formatErrorMessage(error) });
  } finally {
    database?.close();
  }
}
