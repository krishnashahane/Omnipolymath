import { existsSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { closeOmnipolymathStateDatabaseAsync } from "../state/omnipolymath-state-db-cache.js";
import {
  openOmnipolymathStateDatabase,
  runOmnipolymathStateWriteTransaction,
} from "../state/omnipolymath-state-db.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import { readTemplatePackageRefsForAdd } from "../templates/add-state-write.js";
import { readTemplateInventory } from "../templates/inventory-read.js";
import type { PersistedTemplatePackageRef } from "../templates/package-extension-provenance.js";
import {
  makeProvenancePlan,
  seedLegacyTemplateInstall,
  stateEnv,
} from "../templates/provenance.test-helpers.js";
import { withoutMainThreadSql } from "../test-utils/main-thread-sql-spies.test-support.js";

const dirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    await closeOmnipolymathStateDatabaseAsync();
    cleanup();
  }),
);

const emptyInventory = {
  installs: [],
  packages: [],
  workspaceFiles: [],
  mcpServers: [],
  cronJobs: [],
};

it.each([false, true])("reads an empty inventory (existing database: %s)", async (existing) => {
  const captured = captureOmnipolymathStateWorkerContext({
    env: { OMNIPOLYMATH_STATE_DIR: dirs.make("omnipolymath-claw-worker-read-") },
  });
  const options = { path: captured.admission.databasePath, env: captured.environment };
  if (existing) {
    openOmnipolymathStateDatabase(options);
    await closeOmnipolymathStateDatabaseAsync();
  }
  await expect(readTemplateInventory(options)).resolves.toEqual(emptyInventory);
  expect(existsSync(options.path)).toBe(existing);
});

it("preserves installed Template and plugin extension facts through the read-only worker", async () => {
  const root = dirs.make("omnipolymath-claw-inventory-");
  const env = stateEnv(root);
  const { plan } = await makeProvenancePlan(root, {
    schemaVersion: 1,
    agent: { id: "worker" },
  });
  const install = seedLegacyTemplateInstall(plan, { env });
  runOmnipolymathStateWriteTransaction(
    ({ db }) => {
      // Bootstrap persisted input independently of the reader's row conversion.
      db.prepare(`INSERT INTO template_package_refs (
      schema_version, agent_id, template_name, package_kind, package_source, package_ref,
      package_version, package_integrity, package_status, relationship, origin,
      independent_owner, extension_id, extension_format, extension_detected_format,
      extension_mapped_json, extension_unavailable_json, extension_adapter_identity,
      installed_at_ms, updated_at_ms
    ) VALUES ('omnipolymath.templatePackageRef.v1', ?, ?, 'plugin', 'clawhub', '@omnipolymath/tools',
      '1.0.0', 'sha256:fixture', 'complete', 'referenced', 'pre-existing', 1,
      'tools', 'claude', 'claude', '["commands","skills"]', '["agents"]', 'omnipolymath/v1', 123, 123)
    `).run(plan.agent.finalId, plan.template.name);
    },
    { env },
  );
  const pkg: PersistedTemplatePackageRef = {
    schemaVersion: "omnipolymath.templatePackageRef.v1",
    agentId: plan.agent.finalId,
    templateName: plan.template.name,
    kind: "plugin",
    source: "clawhub",
    ref: "@omnipolymath/tools",
    version: "1.0.0",
    integrity: "sha256:fixture",
    status: "complete",
    relationship: "referenced",
    origin: "pre-existing",
    independentOwner: true,
    extension: {
      id: "tools",
      format: "claude",
      detectedFormat: "claude",
      mapped: ["commands", "skills"],
      unavailable: ["agents"],
      adapterIdentity: "omnipolymath/v1",
    },
    installedAtMs: 123,
    updatedAtMs: 123,
  };
  await closeOmnipolymathStateDatabaseAsync();

  await expect(readTemplateInventory({ env })).resolves.toEqual({
    ...emptyInventory,
    installs: [install],
    packages: [pkg],
  });
  await withoutMainThreadSql(async () => {
    await expect(readTemplatePackageRefsForAdd({ env, ref: pkg.ref })).resolves.toEqual([pkg]);
    let admitted = true;
    const pending = readTemplatePackageRefsForAdd({
      env,
      assertCurrent() {
        if (!admitted) {
          throw new Error("Add admission ended");
        }
      },
    });
    admitted = false;
    await expect(pending).rejects.toThrow("Add admission ended");
  });
});
