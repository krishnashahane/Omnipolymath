import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { finalizeAgentToolAvailability } from "./agent-tool-availability.js";
import { bindAssembledAgentToolActionDescriptor } from "./agent-tool-metadata.js";
import {
  type HookContext,
  isToolWrappedWithBeforeToolCallHook,
  wrapToolWithBeforeToolCallHook,
} from "./agent-tools.before-tool-call.js";
import { applyGatewayToolPolicy } from "./gateway-tool-policy.js";
import { filterToolsByClientCaps } from "./omnipolymath-tools.client-caps.js";
import type { OmnipolymathToolsOptions } from "./omnipolymath-tools.types.js";
import { guardScheduledOwnerOnlyTools } from "./scheduled-owner-tool-guard.js";
import { resolveToolLoopDetectionConfig } from "./tool-loop-detection-config.js";
import type { AnyAgentTool } from "./tools/common.js";
import { createGatewayToolCallerWrapper } from "./tools/gateway-caller-context.js";

/** Apply the final policy before binding caller identity and invocation hooks. */
export function finalizeOmnipolymathTools(params: {
  tools: AnyAgentTool[];
  options: OmnipolymathToolsOptions | undefined;
  config: OmnipolymathConfig | undefined;
  hookAgentId: string;
  gatewayCallerAccountId: string | undefined;
}): AnyAgentTool[] {
  const { options, config, hookAgentId, gatewayCallerAccountId } = params;
  const allTools = guardScheduledOwnerOnlyTools(
    finalizeAgentToolAvailability(
      applyGatewayToolPolicy(
        filterToolsByClientCaps(
          params.tools,
          options?.listingClientCaps ?? options?.clientCaps,
          options?.clientCaps,
        ),
        config,
      ),
    ),
    options?.scheduledToolTargets?.assertOwnerCurrent,
  );
  options?.recordToolPrepStage?.("omnipolymath-tools:client-capabilities");
  for (const tool of allTools) {
    bindAssembledAgentToolActionDescriptor(tool);
  }

  const wrapGatewayCallerIdentity = createGatewayToolCallerWrapper(
    hookAgentId,
    options ? { ...options, agentAccountId: gatewayCallerAccountId } : options,
  );

  if (options?.wrapBeforeToolCallHook === false) {
    return allTools.map(wrapGatewayCallerIdentity);
  }
  const defaultHookContext: HookContext = {
    ...(hookAgentId ? { agentId: hookAgentId } : {}),
    ...(config ? { config } : {}),
    ...(options?.agentSessionKey ? { sessionKey: options.agentSessionKey } : {}),
    ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options?.currentChannelId ? { channelId: options.currentChannelId } : {}),
    loopDetection: resolveToolLoopDetectionConfig({ cfg: config, agentId: hookAgentId }),
  };
  const hookContext = { ...defaultHookContext, ...options?.beforeToolCallHookContext };
  options?.recordToolPrepStage?.("omnipolymath-tools:tool-hooks");
  return allTools
    .map((tool) =>
      isToolWrappedWithBeforeToolCallHook(tool)
        ? tool
        : wrapToolWithBeforeToolCallHook(tool, hookContext),
    )
    .map(wrapGatewayCallerIdentity);
}
