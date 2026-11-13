import path from "node:path";
import { normalizeModuleId } from "vite/module-runner";

// Exact source publications, not a naming convention. Keep symbol and string keys
// distinct; override stores and production singletons have separate lifecycle owners.
const publications: Record<string, string | symbol> = {
  "extensions/google/vertex-adc.ts": Symbol.for("omnipolymath.google.vertexAdcTestApi"),
  "src/agents/agent-hooks/compaction-safeguard.ts": Symbol.for(
    "omnipolymath.compactionSafeguardTestApi",
  ),
  "src/agents/auth-profiles/mutation-lineage.ts": Symbol.for(
    "omnipolymath.runtimeAuthSnapshotsTestApi",
  ),
  "src/agents/auth-profiles/usage.ts": Symbol.for("omnipolymath.authProfileUsageTestApi"),
  "src/agents/bash-process-registry.ts": Symbol.for("omnipolymath.bashProcessRegistryTestApi"),
  "src/agents/mcp-ui-resource.ts": Symbol.for("omnipolymath.mcpUiResourceTestApi"),
  "src/agents/prepared-model-runtime.ts": Symbol.for("omnipolymath.preparedModelRuntimeTestApi"),
  "src/agents/session-suspension.ts": Symbol.for("omnipolymath.sessionSuspensionTestApi"),
  "src/agents/subagents/registry/subagent-registry.ts": Symbol.for(
    "omnipolymath.subagentRegistryTestApi",
  ),
  "src/agents/workspace-legacy-state.ts": Symbol.for("omnipolymath.workspaceLegacyStateTestApi"),
  "src/agents/worktrees/run-lease.ts": Symbol.for("omnipolymath.worktreeRunLeaseTestApi"),
  "src/auto-reply/usage-bar/template.ts": Symbol.for("omnipolymath.usageBarTemplateTestApi"),
  "src/cli/gateway-cli/run.ts": Symbol.for("omnipolymath.gatewayRunTestApi"),
  "src/commands/doctor-auth-migration-receipts.ts": Symbol.for(
    "omnipolymath.authProfileMigrationReceiptsTestApi",
  ),
  "src/commands/doctor/shared/codex-native-assets.ts": Symbol.for(
    "omnipolymath.codexNativeAssetsTestApi",
  ),
  "src/commands/doctor/shared/codex-route-session-repair.ts": Symbol.for(
    "omnipolymath.codexRouteSessionRepairTestApi",
  ),
  "src/cron/service/active-run-cancellation.ts": Symbol.for("omnipolymath.activeCronTaskRunTestApi"),
  "src/cron/session-reaper.ts": Symbol.for("omnipolymath.cronSessionReaperTestApi"),
  "src/flows/doctor-health-contributions.ts": Symbol.for(
    "omnipolymath.doctorHealthContributionsTestApi",
  ),
  "src/infra/exec-approvals-sqlite.ts": Symbol.for("omnipolymath.execApprovalsStoreTestApi"),
  "src/logging/diagnostic-run-activity.ts": Symbol.for("omnipolymath.diagnosticRunActivityTestApi"),
  "src/logging/secret-redaction-registry.ts": Symbol.for("omnipolymath.secretRedactionRegistryTestApi"),
  "src/node-host/plugin-node-host.ts": Symbol.for("omnipolymath.nodeHostPluginTestApi"),
  "src/plugins/memory-runtime.ts": Symbol.for("omnipolymath.memoryRuntimeTestApi"),
  "src/sessions/session-controller.stop.ts": Symbol.for("omnipolymath.sessionControllerTestApi"),
  "src/sessions/session-controller.storage.ts": Symbol.for("omnipolymath.sessionControllerTestApi"),
  "src/sessions/session-upstream-monitor.ts": Symbol.for("omnipolymath.sessionUpstreamMonitorTestApi"),
  "src/skills/runtime/remote-skills.ts": Symbol.for("omnipolymath.remoteNodeSkillsTestApi"),
  "src/talk/client-voice-session.ts": Symbol.for("omnipolymath.clientVoiceSessionTestApi"),
};

// Vite's EvaluatedModuleNode.file is a normalized, query-free filesystem path.
// Store only paths and keys: this table must never retain published API values.
export const repositoryTestApiPublications: ReadonlyMap<string, string | symbol> = new Map(
  Object.entries(publications).map(([source, key]) => [
    normalizeModuleId(path.resolve(import.meta.dirname, "..", source)),
    key,
  ]),
);
