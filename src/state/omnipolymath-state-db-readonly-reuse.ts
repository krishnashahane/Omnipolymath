import { isPromiseLike } from "@omnipolymath/normalization-core/promise-like";
import { SqliteCoordinatorError } from "../infra/sqlite-lifecycle-errors.js";
import { runSqliteReadOperationSync } from "../infra/sqlite-schema-facts.js";
import { assertExistingDatabaseIdentity } from "../infra/sqlite-worker-identity.js";
import {
  getOmnipolymathDatabaseMaintenanceScope,
  observeOmnipolymathDatabaseMaintenanceResource,
  type OmnipolymathDatabaseMaintenanceScope,
} from "./omnipolymath-state-db-async-lifecycle.js";
import {
  captureOmnipolymathStateDatabaseReadAdmission,
  omnipolymathStateDatabaseCache,
  registerOmnipolymathStatePathAsyncResource,
  requireOmnipolymathStateDatabaseIdentity,
} from "./omnipolymath-state-db-cache.js";
import type { OmnipolymathStateDatabase } from "./omnipolymath-state-db-contract.js";
import {
  assertStateReadSchema,
  openOmnipolymathStateReadOnlyLocation,
} from "./omnipolymath-state-db-read-connection.js";
import { isManagedStateTransaction } from "./omnipolymath-state-db-transaction.js";
import { allowsMaintenanceLiveAuthorityReads } from "./omnipolymath-state-maintenance-context.js";
import type { OmnipolymathStateReadOnlyDatabase } from "./omnipolymath-state-read.types.js";

export type ReusedOmnipolymathStateReadOnlyDatabase<T> = { reused: false } | { reused: true; value: T };

const maintenanceReaders = new WeakMap<
  OmnipolymathDatabaseMaintenanceScope,
  Map<string, { read: <T>(operation: (db: OmnipolymathStateReadOnlyDatabase) => T) => T }>
>();

/** Mutable maintenance owns this live reader until drainage; each guard queries current rows. */
export function withMaintenanceOmnipolymathStateDatabaseReadOnly<T>(
  operation: (database: OmnipolymathStateReadOnlyDatabase) => T,
  pathname: string,
): ReusedOmnipolymathStateReadOnlyDatabase<T> {
  const scope = getOmnipolymathDatabaseMaintenanceScope();
  if (!scope || !allowsMaintenanceLiveAuthorityReads(scope, pathname)) {
    return { reused: false };
  }
  scope.assertReadAdmission();
  let readers = maintenanceReaders.get(scope);
  if (!readers) {
    readers = new Map();
    maintenanceReaders.set(scope, readers);
  }
  let reader = readers.get(pathname);
  if (!reader) {
    const admission = captureOmnipolymathStateDatabaseReadAdmission(pathname);
    assertExistingDatabaseIdentity(pathname, admission.identity.key, admission.identity.birthtime);
    const connection = openOmnipolymathStateReadOnlyLocation(pathname, pathname);
    let closed = false;
    const close = () => {
      if (closed) {
        return;
      }
      if (!connection.close()) {
        throw new Error("Maintenance authority reader cleanup is incomplete");
      }
      closed = true;
      readers.delete(pathname);
      unregister();
    };
    const unregister = registerOmnipolymathStatePathAsyncResource(admission, async () => {
      close();
    });
    scope.own(connection, "shared-handles", close);
    reader = {
      read(readOperation) {
        admission.assertCurrent();
        assertExistingDatabaseIdentity(
          pathname,
          admission.identity.key,
          admission.identity.birthtime,
        );
        const value = runSqliteReadOperationSync(connection.database.db, () => {
          assertStateReadSchema(connection.database.db, pathname);
          return readOperation(connection.database);
        });
        if (isPromiseLike(value)) {
          throw new SqliteCoordinatorError(
            "SQLite maintenance authority read must remain synchronous",
          );
        }
        return value;
      },
    };
    readers.set(pathname, reader);
  }
  return { reused: true, value: reader.read(operation) };
}

/** Current-authority guards can borrow their writer; discovery sees committed rows. */
export function withCachedOmnipolymathStateDatabaseReadOnly<T>(
  operation: (database: OmnipolymathStateReadOnlyDatabase) => T,
  pathname: string,
  currentAuthority: boolean,
): ReusedOmnipolymathStateReadOnlyDatabase<T> {
  return (
    omnipolymathStateDatabaseCache.withCachedOmnipolymathStateDatabase(
      pathname,
      { readOnly: true },
      (opened): ReusedOmnipolymathStateReadOnlyDatabase<T> => {
        if (!opened.db.isOpen) {
          return { reused: false };
        }
        const ownedTransaction = currentAuthority && isManagedStateTransaction(opened.db);
        if (opened.db.isTransaction && !ownedTransaction) {
          return { reused: false };
        }
        try {
          // Cache admission and the consuming read share this operation's fresh revision.
          assertStateReadSchema(opened.db, pathname);
          observeOmnipolymathDatabaseMaintenanceResource(opened.db);
          const value = operation(opened);
          if (ownedTransaction && isPromiseLike(value)) {
            throw new SqliteCoordinatorError(
              "SQLite current-authority read must remain synchronous",
            );
          }
          return { reused: true, value };
        } catch (error) {
          omnipolymathStateDatabaseCache.evictOmnipolymathStateDatabaseAfterCorruption(opened, error);
          throw error;
        }
      },
    ) ?? { reused: false }
  );
}

/** A native read borrow can avoid copying only while its original physical path still matches. */
export function canReadWarmNativeSourceIndependently(
  database: OmnipolymathStateDatabase,
  pathname: string,
  admittedIdentity: string,
): boolean {
  const identity = requireOmnipolymathStateDatabaseIdentity(database);
  if (identity.key !== admittedIdentity) {
    return false;
  }
  try {
    assertExistingDatabaseIdentity(pathname, identity.key);
    return true;
  } catch {
    // An unavailable or replaced path keeps the original native snapshot source.
    return false;
  }
}
