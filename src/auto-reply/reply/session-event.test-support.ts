import { expectDefined } from "@omnipolymath/normalization-core/expect";
import type { TestContext } from "vitest";
import {
  applyEmbeddedAttemptToolsAllow,
  resolveEmbeddedAttemptToolConstructionPlan,
} from "../../agents/embedded-agent-runner/run/attempt-tool-construction-plan.js";
import { buildEmbeddedAttemptToolRunContext } from "../../agents/embedded-agent-runner/run/attempt-tool-run-context.js";
import type { RunEmbeddedAgentParams } from "../../agents/embedded-agent-runner/run/params.js";
import { createAgentHarnessHostCapabilities } from "../../agents/harness/host-capability.js";
import { resolveAttemptWorkspaceSandbox } from "../../agents/workspace-sandbox.js";
import { setRuntimeConfigSnapshot } from "../../config/runtime-snapshot.js";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import { openOmnipolymathStateDatabase } from "../../state/omnipolymath-state-db.js";
import {
  withOmnipolymathTestState,
  type OmnipolymathTestState,
} from "../../test-utils/omnipolymath-test-state.js";
import { createReplyAgentDefaults } from "./get-reply-config.test-support.js";

export async function configureEventState(
  state: OmnipolymathTestState,
  overrides: Partial<OmnipolymathConfig> = {},
) {
  const config: OmnipolymathConfig = {
    agents: {
      entries: { main: { workspace: state.workspaceDir } },
      defaults: createReplyAgentDefaults(state.workspaceDir),
    },
    plugins: { enabled: false },
    skills: { load: { watch: false } },
    ...overrides,
  };
  setRuntimeConfigSnapshot(config);
  await state.writeConfig(config);
  openOmnipolymathStateDatabase();
  return config;
}

export async function startEmbeddedTurn(params: RunEmbeddedAgentParams, label: string) {
  const admission = expectDefined(params.preparedRunAdmission, label);
  const context = await admission.admit("gateway", params.runId);
  params.onExecutionPhase?.({ phase: "model_call_started" });
  await params.onExecutionStarted?.();
  await params.onAgentEvent?.({ stream: "lifecycle", data: { phase: "start" } });
  return context;
}

export function runEventFixture(
  label: string,
  onTestFinished: TestContext["onTestFinished"],
  run: (state: OmnipolymathTestState) => Promise<void>,
) {
  const work = withOmnipolymathTestState({ label, env: { OMNIPOLYMATH_TEST_FAST: "0" } }, run);
  // Cancellation must settle the state owner even when the test body times out.
  onTestFinished(async () => {
    await Promise.allSettled([work]);
  });
  return work;
}

/** Admits an event turn and opens its real managed tool host; only the model is synthetic. */
export async function openEventToolHost(
  params: RunEmbeddedAgentParams,
  label: string,
  options: { includeOmnipolymathTools?: boolean } = {},
) {
  const admittedRunContext = await startEmbeddedTurn(params, label);
  const workspace = await resolveAttemptWorkspaceSandbox({ ...params, admittedRunContext });
  const host = createAgentHarnessHostCapabilities({
    attempt: {
      admittedRunContext,
      runId: params.runId,
      abortSignal: params.abortSignal,
      config: params.config,
      agentId: params.agentId,
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      sessionTarget: params.sessionTarget,
      permissionMode: params.permissionMode,
      requireWorkspaceOnly: params.requireWorkspaceOnly,
      sessionRoot: workspace.sessionPermissionRoot,
      workspaceDir: params.workspaceDir,
      bootstrapWorkspaceDir: params.bootstrapWorkspaceDir,
      cwd: params.cwd,
      sandboxAgentId: params.sandboxAgentId,
      skillsSnapshot: params.skillsSnapshot,
      toolExecutionAllow: params.toolExecutionAllow,
      toolsAllow: params.toolsAllow,
      runtimePluginToolGrant: params.runtimePluginToolGrant,
      trigger: params.trigger,
      senderIsOwner: params.senderIsOwner,
      messageChannel: params.messageChannel,
      messageProvider: params.messageProvider,
      agentAccountId: params.agentAccountId,
    },
    pluginId: "omnipolymath",
  });
  const createToolSurface = expectDefined(
    host.capabilities.createToolSurface,
    "managed tool surface",
  );
  const toolRunContext = buildEmbeddedAttemptToolRunContext({
    ...params,
    model:
      params.provider && params.model ? { provider: params.provider, id: params.model } : undefined,
  });
  const construction = resolveEmbeddedAttemptToolConstructionPlan({
    toolsAllow: toolRunContext.runtimeToolAllowlist,
  });
  const tools = applyEmbeddedAttemptToolsAllow(
    createToolSurface({
      ...toolRunContext,
      config: params.config,
      agentId: params.agentId,
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      workspaceDir: workspace.effectiveWorkspace,
      cwd: workspace.effectiveCwd,
      sessionPermissionPolicy: workspace.sessionPermissionPolicy,
      toolConstructionPlan: {
        ...construction.codingToolConstructionPlan,
        includeShellTools: false,
        includeChannelTools: false,
        includeOmnipolymathTools: options.includeOmnipolymathTools === true,
        includePluginTools: false,
      },
    }),
    construction.runtimeToolAllowlist,
  );
  return { admittedRunContext, tools, close: () => host.close() };
}
