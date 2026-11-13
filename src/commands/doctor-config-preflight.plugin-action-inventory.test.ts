import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { writeOmnipolymathConfig } from "../config/test-helpers.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { runSessionTranscriptsHealth } from "../flows/doctor-health-contribution-runners.state.js";
import {
  readDeferredPluginMigrations,
  recordDeferredPluginMigrations,
} from "../infra/deferred-plugin-migrations.js";
import { autoMigrateLegacyState } from "../infra/state-migrations.doctor.js";
import { withDeferredPluginDoctorMigrations } from "../plugins/doctor-contract-registry.js";
import { clearPluginDoctorContractRegistryCache } from "../plugins/doctor-contract-registry.test-fixtures.js";
import { writePersistedInstalledPluginIndexInstallRecordsWithLease } from "../plugins/installed-plugin-index-records.js";
import { EMPTY_LEGACY_SESSION_SURFACES } from "../plugins/legacy-session-surfaces.types.js";
import { withPluginLifecycleLease } from "../plugins/plugin-lifecycle-lease.js";
import { closeOmnipolymathAgentDatabasesForTest } from "../state/omnipolymath-agent-db.js";
import {
  closeOmnipolymathStateDatabaseForTest,
  openOmnipolymathStateDatabase,
} from "../state/omnipolymath-state-db.js";
import { withEnvAsync } from "../test-utils/env.js";
import { prepareDoctorContext } from "./doctor-config-flow.test-support.js";
import { assertDoctorPreflightMigrationsComplete } from "./doctor-config-preflight-migrations.js";
import { useDoctorConfigPreflightHome } from "./doctor-config-preflight.test-support.js";
import { noteSessionTranscriptHealth } from "./doctor-session-transcripts.js";

const withHome = useDoctorConfigPreflightHome();
const actions = [
  { pluginId: "acpx", id: "acpx-session-owner-resources" },
  { pluginId: "codex", id: "codex-app-server-orphaned-session-bindings" },
];
const version = "2026.9.6";
const retainedState = "retained session state";
const contents = (root: string, name: string) => fs.readFileSync(path.join(root, name), "utf8");

afterEach(() => {
  clearPluginDoctorContractRegistryCache();
  closeOmnipolymathAgentDatabasesForTest();
  closeOmnipolymathStateDatabaseForTest();
});

it.each(["deferred-doctor", "doctor"] as const)(
  "keeps %s post-session execution bound to the admitted external plugin inventory",
  async (caller) => {
    await withHome(async (home) => {
      const stateDir = path.join(home, ".omnipolymath");
      const bundledRoot = path.join(home, "bundled");
      const externalRoot = path.join(home, "npm", "lib", "node_modules", "@omnipolymath");
      const externalPath = (pluginId: string) => path.join(externalRoot, pluginId);
      for (const root of [bundledRoot, externalRoot]) {
        for (const { pluginId, id } of actions) {
          const pluginRoot = path.join(root, pluginId);
          const source = path.join(pluginRoot, "pending-session-state");
          const target = path.join(pluginRoot, "migrated-session-state");
          const action = { id, doctorOnly: true, phase: "after-session-repair" };
          const write = (name: string, content: object | string) =>
            fs.writeFileSync(
              path.join(pluginRoot, name),
              typeof content === "string" ? content : JSON.stringify(content),
            );
          fs.mkdirSync(pluginRoot, { recursive: true });
          write("package.json", {
            name: `@omnipolymath/${pluginId}`,
            version,
            type: "commonjs",
            omnipolymath: {
              extensions: ["./index.cjs"],
              compat: { pluginApi: `>=${version}` },
              build: { omnipolymathVersion: version },
            },
          });
          write("omnipolymath.plugin.json", {
            id: pluginId,
            configSchema: {},
            doctorContract: { stateMigrations: [action] },
          });
          write("index.cjs", "throw new Error('Doctor must not load plugin runtime');\n");
          fs.writeFileSync(source, retainedState);
          write(
            "doctor-contract-api.cjs",
            `const fs = require("node:fs");
module.exports = { stateMigrations: [{
  ...${JSON.stringify(action)}, label: ${JSON.stringify(pluginId)},
  detectLegacyState: () => fs.existsSync(${JSON.stringify(source)}) ? { preview: ["pending"] } : null,
  migrateLegacyState: () => {
    fs.renameSync(${JSON.stringify(source)}, ${JSON.stringify(target)});
    return { changes: [${JSON.stringify(`migrated ${pluginId}`)}], warnings: [] };
  },
}] };\n`,
          );
        }
      }
      const cfg: OmnipolymathConfig = {
        gateway: { mode: "local" },
        agents: { entries: { main: { workspace: path.join(home, "workspace") } } },
        plugins: {
          allow: ["acpx", "codex"],
          entries: { acpx: { enabled: true }, codex: { enabled: true } },
          load: { paths: actions.map(({ pluginId }) => externalPath(pluginId)) },
        },
      };
      const configPath = await writeOmnipolymathConfig(home, cfg);
      await withEnvAsync(
        {
          OMNIPOLYMATH_STATE_DIR: stateDir,
          OMNIPOLYMATH_CONFIG_PATH: configPath,
          OMNIPOLYMATH_BUNDLED_PLUGINS_DIR: bundledRoot,
          OMNIPOLYMATH_TEST_TRUST_BUNDLED_PLUGINS_DIR: "1",
          OMNIPOLYMATH_DISABLE_BUNDLED_PLUGINS: undefined,
        },
        async () => {
          const env = process.env;
          openOmnipolymathStateDatabase({ env });
          if (caller === "deferred-doctor") {
            await withPluginLifecycleLease({ env }, (lease) =>
              writePersistedInstalledPluginIndexInstallRecordsWithLease(
                Object.fromEntries(
                  actions.map(({ pluginId }) => [
                    pluginId,
                    {
                      source: "npm" as const,
                      spec: `@omnipolymath/${pluginId}@${version}`,
                      version,
                      installPath: externalPath(pluginId),
                    },
                  ]),
                ),
                { config: cfg, env, lease },
              ),
            );
          }
          const pending =
            caller === "deferred-doctor"
              ? [
                  {
                    pluginId: "codex",
                    reason: "Package convergence warning",
                    command: "omnipolymath update repair",
                    requiresStateMigration: true as const,
                  },
                ]
              : [];
          if (pending.length > 0) {
            await recordDeferredPluginMigrations({ env, pending });
          }
          const admitted = caller === "deferred-doctor" ? actions.slice(0, 1) : actions;
          let receipt;
          if (caller === "doctor") {
            await using ctx = await prepareDoctorContext(configPath);
            expect(ctx.configResult.postSessionPluginMigration?.plannedActions).toEqual(actions);
            assert.ok(ctx.runWithPluginMetadataSnapshot);
            await ctx.runWithPluginMetadataSnapshot({ config: ctx.cfg }, () =>
              runSessionTranscriptsHealth(ctx),
            );
            receipt = ctx.configResult.stateMigrationStepReceipts?.at(-1);
          } else {
            // Convergence exclusions belong to preflight's metadata scope, which ends
            // before Doctor completes the deferred session phase.
            const prepared = await withDeferredPluginDoctorMigrations(["codex"], () =>
              autoMigrateLegacyState({
                cfg,
                env,
                homedir: () => home,
                doctorOnlyStateMigrations: true,
                invocationPurpose: "doctor",
                legacySessionSurfaces: EMPTY_LEGACY_SESSION_SURFACES,
              }),
            );
            assert.ok(prepared.postSessionPluginMigration);
            expect(prepared.postSessionPluginMigration.plannedActions).toEqual(admitted);

            await assertDoctorPreflightMigrationsComplete({
              cfg,
              stepReceipts: prepared.stepReceipts,
              report: () => {},
            });
            await noteSessionTranscriptHealth({
              cfg,
              env,
              shouldRepair: true,
              postSessionPluginMigration: prepared.postSessionPluginMigration,
              postSessionPluginMigrationPlanBound: true,
              onStepReceipt: (step) => prepared.stepReceipts.push(step),
            });
            receipt = prepared.stepReceipts.at(-1);
          }

          expect(receipt).toMatchObject({
            id: "plugin-doctor-post-session-state",
            outcome: "completed",
            changes: admitted.map(({ pluginId }) => `migrated ${pluginId}`),
            warnings: [],
          });
          for (const { pluginId } of admitted) {
            expect(contents(externalPath(pluginId), "migrated-session-state")).toBe(retainedState);
          }
          for (const pluginRoot of [
            ...(caller === "deferred-doctor" ? [externalPath("codex")] : []),
            ...actions.map(({ pluginId }) => path.join(bundledRoot, pluginId)),
          ]) {
            expect(contents(pluginRoot, "pending-session-state")).toBe(retainedState);
            expect(fs.existsSync(path.join(pluginRoot, "migrated-session-state"))).toBe(false);
          }
          expect(readDeferredPluginMigrations({ env })).toEqual(pending);
        },
      );
    });
  },
);
