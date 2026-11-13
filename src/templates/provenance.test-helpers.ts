import { join } from "node:path";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import type { DB } from "../state/omnipolymath-state-db.generated.js";
import {
  runOmnipolymathStateWriteTransaction,
  type OmnipolymathStateDatabaseOptions,
} from "../state/omnipolymath-state-db.js";
import { digestTemplateOwnedAgentConfig } from "./agent-config-ownership.js";
import { buildTemplateAddPlan } from "./lifecycle.js";
import type { PersistedTemplateInstall } from "./provenance-types.js";
import { parseTemplateManifest } from "./schema.js";
import type {
  TemplateAddPlan,
  TemplateSourceIdentity,
  TemplateWorkspaceSourceSnapshot,
} from "./types.js";

export async function makeProvenancePlan(
  root: string,
  manifestValue: unknown,
  options: {
    workspace?: string;
    packageBootstrap?: TemplateWorkspaceSourceSnapshot;
    packagePreflight?: NonNullable<
      Parameters<typeof buildTemplateAddPlan>[0]["context"]
    >["packagePreflight"];
  } = {},
) {
  const parsed = parseTemplateManifest(manifestValue);
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.diagnostics));
  }
  const source: TemplateSourceIdentity = {
    kind: "package",
    name: "@acme/worker",
    version: "1.0.0",
    packageRoot: root,
    manifestPath: join(root, "omnipolymath.template.json"),
    integrityKind: "artifact",
    integrity: "sha256:manifest",
    byteLength: 123,
  };
  const plan = await buildTemplateAddPlan({
    manifest: parsed.manifest,
    packageBootstrap: options.packageBootstrap,
    source,
    context: {
      workspace: options.workspace ?? join(root, "workspace-worker"),
      ...(options.packagePreflight ? { packagePreflight: options.packagePreflight } : {}),
    },
  });
  return { root, plan };
}

export function stateEnv(root: string) {
  return { OMNIPOLYMATH_STATE_DIR: join(root, "state") };
}

/** Legacy rows remain readable even though one-way Add no longer writes them. */
export function seedLegacyTemplateInstall(
  plan: TemplateAddPlan,
  options: OmnipolymathStateDatabaseOptions,
): PersistedTemplateInstall {
  const agentConfigDigest = digestTemplateOwnedAgentConfig(plan.agent.config);
  const agentOwnedPaths = plan.actions
    .filter((action) => action.kind === "agent")
    .map((action) => action.target);
  runOmnipolymathStateWriteTransaction(({ db }) => {
    executeSqliteQuerySync(
      db,
      getNodeSqliteKysely<Pick<DB, "template_installs">>(db)
        .insertInto("template_installs")
        .values({
          agent_id: plan.agent.finalId,
          schema_version: "omnipolymath.templateInstallRecord.v2",
          source_kind: plan.template.kind,
          template_name: plan.template.name,
          template_version: plan.template.version,
          package_root: plan.template.packageRoot,
          manifest_path: plan.template.manifestPath,
          integrity_kind: plan.template.integrityKind,
          integrity: plan.template.integrity,
          source_byte_length: plan.template.byteLength,
          manifest_schema_version: plan.manifestSchemaVersion,
          plan_integrity: plan.planIntegrity,
          workspace: plan.agent.workspace,
          agent_config_digest: agentConfigDigest,
          agent_owned_paths_json: JSON.stringify(agentOwnedPaths),
          bootstrap_source_path: null,
          bootstrap_content_digest: null,
          status: "complete",
          added_at_ms: 123,
          updated_at_ms: 123,
        }),
    );
  }, options);
  return {
    schemaVersion: "omnipolymath.templateInstallRecord.v2",
    template: plan.template,
    manifestSchemaVersion: plan.manifestSchemaVersion,
    planIntegrity: plan.planIntegrity,
    agentId: plan.agent.finalId,
    workspace: plan.agent.workspace,
    agentConfigDigest,
    agentOrigin: "created",
    agentOwnedPaths,
    status: "complete",
    addedAtMs: 123,
    updatedAtMs: 123,
  };
}
