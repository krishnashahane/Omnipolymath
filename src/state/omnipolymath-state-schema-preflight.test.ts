import { afterEach, expect, it } from "vitest";
import { trackSqliteStatementExecutions } from "../../test/helpers/sqlite-statement-execution-counter.js";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { runSqliteReadOperationSync } from "../infra/sqlite-schema-facts.js";
import { requireNativeSqliteDatabase } from "../test-utils/native-sqlite.js";
import { OMNIPOLYMATH_STATE_SCHEMA_VERSION } from "./omnipolymath-state-db-contract.js";
import {
  closeOmnipolymathStateDatabaseForTest,
  openOmnipolymathStateDatabase,
} from "./omnipolymath-state-db.js";
import { inspectStateDatabaseSchema } from "./omnipolymath-state-schema-preflight.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => {
  closeOmnipolymathStateDatabaseForTest();
});

it("reuses admitted headers while observing writes and retaining explicit verification", () => {
  const env = { OMNIPOLYMATH_STATE_DIR: tempDirs.make("state-header-admission-") };
  const state = openOmnipolymathStateDatabase({ env });
  const database = requireNativeSqliteDatabase(state.db);
  const inspect = (verifyCurrentSchemaShape = false) =>
    runSqliteReadOperationSync(database, () =>
      inspectStateDatabaseSchema(database, {
        pathname: state.path,
        supportedVersion: OMNIPOLYMATH_STATE_SCHEMA_VERSION,
        scope: "state",
        purpose: verifyCurrentSchemaShape ? "maintenance" : "runtime",
        verifyCurrentSchemaShape,
      }),
    ).schemas;
  const probes = trackSqliteStatementExecutions(database, ["header"], (sql) =>
    /^PRAGMA\s+user_version\s*;?$/iu.test(sql.trim()) ? "header" : null,
  );
  try {
    expect(inspect()).toEqual({ incompatible: [], indeterminate: [] });
    expect(probes.counts.header).toBe(0);
    expect(inspect(true)).toEqual({ incompatible: [], indeterminate: [] });
    expect(probes.counts.header).toBe(1);

    database.exec(`PRAGMA user_version = ${OMNIPOLYMATH_STATE_SCHEMA_VERSION + 1};`);
    expect(inspect()).toMatchObject({
      incompatible: [
        { kind: "state", path: state.path, foundVersion: OMNIPOLYMATH_STATE_SCHEMA_VERSION + 1 },
      ],
      indeterminate: [],
    });
    database.exec(
      `PRAGMA user_version = ${OMNIPOLYMATH_STATE_SCHEMA_VERSION}; DROP TABLE schema_meta;`,
    );
    expect(inspect(true)).toMatchObject({
      incompatible: [],
      indeterminate: [{ kind: "state", path: state.path }],
    });
  } finally {
    probes.restore();
  }
});
