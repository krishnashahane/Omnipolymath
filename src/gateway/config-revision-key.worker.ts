import { executeSqliteQueryTakeFirstSync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import { getAdmittedSqliteSchemaFacts } from "../infra/sqlite-schema-facts.js";
import type {
  OmnipolymathStateDatabase,
  OmnipolymathStateDatabaseOptions,
} from "../state/omnipolymath-state-db-contract.js";
import { ensureConfigRevisionKeySchema } from "../state/omnipolymath-state-db-schema-additive.js";
import type { DB } from "../state/omnipolymath-state-db.generated.js";
import { runOmnipolymathStateWriteTransaction } from "../state/omnipolymath-state-db.js";

/** Return the installation key without rotating existing revision or response-session tokens. */
export function loadOrCreateConfigRevisionKeyInDatabase(
  database: OmnipolymathStateDatabase,
  candidateKey: Uint8Array,
  options: OmnipolymathStateDatabaseOptions,
): Uint8Array {
  const singleStatement =
    getAdmittedSqliteSchemaFacts(database.db)?.tables.has("config_revision_keys") === true;
  const stored = runOmnipolymathStateWriteTransaction(
    ({ db }) => {
      // First-use DDL and PostgreSQL fragments retain the state owner's transaction.
      if (!singleStatement) {
        ensureConfigRevisionKeySchema(db);
      }
      return executeSqliteQueryTakeFirstSync(
        db,
        getNodeSqliteKysely<Pick<DB, "config_revision_keys">>(db)
          .insertInto("config_revision_keys")
          .values({ id: 1, hmac_key: candidateKey })
          .onConflict((conflict) =>
            conflict.column("id").doUpdateSet((eb) => ({
              hmac_key: eb.ref("config_revision_keys.hmac_key"),
            })),
          )
          .returning("hmac_key"),
      );
    },
    { ...options, database },
    {
      operationLabel: "gateway.config-revision-key.load",
      singleStatement: singleStatement ? true : undefined,
    },
  );
  if (!stored) {
    throw new Error("config revision key could not be created");
  }
  return stored.hmac_key;
}
