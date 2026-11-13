import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { closeOmnipolymathStateDatabaseByPathAsync } from "../state/omnipolymath-state-db.js";
import { resolveOmnipolymathStateSqlitePath } from "../state/omnipolymath-state-db.paths.js";
import { withOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";
import { preparePluginDoctorMigrationBackupResources } from "./doctor-contract-preparation.js";
import { writePersistedInstalledPluginIndex } from "./installed-plugin-index-store-write.js";
import { createPluginCache, retirePluginCache, withPluginCache } from "./plugin-cache.js";
import { createFixture } from "./plugin-generation-artifact.admission.test-support.js";
import { settlePluginNativeAdmissions } from "./plugin-native-admission-state.js";

it("keeps native Doctor resource discovery from publishing into live shared state", async () => {
  await withOmnipolymathTestState({ label: "doctor-native-resource-inventory" }, async (state) => {
    const fixture = createFixture(state.path("installed"), true);
    const manifest = JSON.stringify({
      id: "fixture",
      configSchema: { type: "object" },
      doctorContract: { stateMigrations: true },
    });
    fs.writeFileSync(path.join(fixture.root, "omnipolymath.plugin.json"), manifest);
    fixture.index.plugins[0]!.manifestHash = createHash("sha256").update(manifest).digest("hex");
    fs.writeFileSync(
      path.join(fixture.root, "doctor-contract-api.cjs"),
      `const fs = require("node:fs");
       const path = require("node:path");
       module.exports.stateMigrations = [{
         id: "fixture-state", label: "Fixture state",
         collectBackupResources({ stateDir }) {
           fs.readFileSync(path.join(__dirname, "fixture.bin"));
           return [{ path: path.join(stateDir, "fixture-data"), kind: "directory" }];
         },
         detectLegacyState() { return null; },
         migrateLegacyState() { throw new Error("inventory must not migrate"); }
       }];`,
    );
    await writePersistedInstalledPluginIndex(fixture.index, { env: state.env });
    const databasePath = resolveOmnipolymathStateSqlitePath(state.env);
    await closeOmnipolymathStateDatabaseByPathAsync(databasePath);
    const before = fs.readFileSync(databasePath);
    const cache = createPluginCache();
    try {
      await withPluginCache(cache, async () => {
        const result = await preparePluginDoctorMigrationBackupResources({
          config: {
            plugins: {
              allow: ["fixture"],
              load: { paths: [fixture.root] },
              entries: { fixture: { enabled: true } },
            },
          },
          env: { ...state.env, OMNIPOLYMATH_DISABLE_BUNDLED_PLUGINS: "1" },
          stateDir: state.stateDir,
          warnings: [],
          requireLocalResources: true,
        });
        expect(result.resources).toEqual([
          { path: path.join(state.stateDir, "fixture-data"), kind: "directory" },
        ]);
        await settlePluginNativeAdmissions(cache);
      });
    } finally {
      await retirePluginCache(cache);
      await closeOmnipolymathStateDatabaseByPathAsync(databasePath);
    }
    expect(fs.readFileSync(databasePath)).toEqual(before);
  });
});
