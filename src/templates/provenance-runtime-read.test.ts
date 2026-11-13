import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTempDirTracker } from "../../test/helpers/temp-dir.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import type { DB } from "../state/omnipolymath-state-db.generated.js";
import {
  closeOmnipolymathStateDatabaseAsync,
  closeOmnipolymathStateDatabaseForTest,
  openOmnipolymathStateDatabase,
  runOmnipolymathStateWriteTransaction,
} from "../state/omnipolymath-state-db.js";
import {
  prepareTemplateInstallSchemaVersions,
  readCachedTemplateInstallSchemaVersions,
} from "./provenance-runtime-read.js";
import { makeProvenancePlan, seedLegacyTemplateInstall } from "./provenance.test-helpers.js";

const tempDirs = createTempDirTracker();
const emptyOwnership = { kind: "ready", schemaVersions: new Map() };
const snapshot = async (options: Parameters<typeof prepareTemplateInstallSchemaVersions>[0]) => {
  (await prepareTemplateInstallSchemaVersions(options)).publish();
  return readCachedTemplateInstallSchemaVersions(options);
};
afterEach(async () => {
  await closeOmnipolymathStateDatabaseAsync();
  closeOmnipolymathStateDatabaseForTest();
  tempDirs.cleanup();
});

describe("Template runtime provenance cache", () => {
  it.each(["absent", "existing"])(
    "reads empty %s state without WAL/SHM sidecars",
    async (state) => {
      const root = tempDirs.make("omnipolymath-template-runtime-provenance-empty-");
      const options = { env: { OMNIPOLYMATH_STATE_DIR: root } };
      if (state === "existing") {
        openOmnipolymathStateDatabase(options);
        closeOmnipolymathStateDatabaseForTest();
      }
      expect(await snapshot(options)).toMatchObject(emptyOwnership);
      const stateFile = join(root, "state", "omnipolymath.sqlite");
      expect(["-wal", "-shm"].map((suffix) => existsSync(stateFile + suffix))).toEqual([
        false,
        false,
      ]);
    },
  );

  it("reloads legacy ownership after closure and fails closed when the database disappears", async () => {
    const root = tempDirs.make("omnipolymath-template-runtime-provenance-");
    const options = { env: { OMNIPOLYMATH_STATE_DIR: root } };
    const database = openOmnipolymathStateDatabase(options);

    expect(await snapshot(options)).toMatchObject(emptyOwnership);

    const { plan } = await makeProvenancePlan(root, { schemaVersion: 1, agent: { id: "worker" } });
    const { schemaVersion, agentConfigDigest } = seedLegacyTemplateInstall(plan, options);
    await closeOmnipolymathStateDatabaseAsync();
    expect(await snapshot(options)).toMatchObject({
      kind: "ready",
      schemaVersions: new Map([["worker", { kind: "ok", schemaVersion, agentConfigDigest }]]),
    });

    runOmnipolymathStateWriteTransaction(
      ({ db }) =>
        executeSqliteQuerySync(
          db,
          getNodeSqliteKysely<Pick<DB, "template_installs">>(db)
            .deleteFrom("template_installs")
            .where("agent_id", "=", "worker"),
        ),
      options,
    );
    await closeOmnipolymathStateDatabaseAsync();
    expect(await snapshot(options)).toEqual(emptyOwnership);

    seedLegacyTemplateInstall(plan, options);
    await closeOmnipolymathStateDatabaseAsync();
    (await prepareTemplateInstallSchemaVersions(options)).publish();

    openOmnipolymathStateDatabase(options);
    await closeOmnipolymathStateDatabaseAsync();
    rmSync(database.path);
    expect(await snapshot(options)).toMatchObject({
      kind: "state-error",
      knownAgentIds: new Set(["worker"]),
      ownershipUnknown: true,
    });
  });
});
