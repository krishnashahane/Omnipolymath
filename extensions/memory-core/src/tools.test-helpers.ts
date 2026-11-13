import type { OmnipolymathPluginToolContext } from "omnipolymath/plugin-sdk/plugin-entry";
// Memory Core helper module supports tools helpers behavior.
import { expect } from "vitest";
import type { OmnipolymathConfig } from "../api.js";
import { runInMemoryTestBackgroundContext } from "./memory/background-context.test-support.js";
import { isolateMemoryManagerTestConfig } from "./memory/test-config-helpers.js";
import { createMemoryGetTool, createMemorySearchTool } from "./tools.js";

export function asOmnipolymathConfig(config: Partial<OmnipolymathConfig>): OmnipolymathConfig {
  return isolateMemoryManagerTestConfig(config as OmnipolymathConfig);
}

function createDefaultMemoryToolConfig(): OmnipolymathConfig {
  return asOmnipolymathConfig({ agents: { entries: { main: {} } } });
}

export function createMemorySearchToolOrThrow(params?: {
  config?: OmnipolymathConfig;
  agentId?: string;
  agentSessionKey?: string;
  oneShotCliRun?: boolean;
  conversationRecall?: OmnipolymathPluginToolContext["conversationRecall"];
  activeProjectKeys?: readonly string[];
}) {
  const tool = createMemorySearchTool({
    runInBackgroundContext: runInMemoryTestBackgroundContext,
    config: params?.config ? asOmnipolymathConfig(params.config) : createDefaultMemoryToolConfig(),
    ...(params?.agentId ? { agentId: params.agentId } : {}),
    ...(params?.agentSessionKey ? { agentSessionKey: params.agentSessionKey } : {}),
    ...(params?.oneShotCliRun ? { oneShotCliRun: params.oneShotCliRun } : {}),
    ...(params?.conversationRecall ? { conversationRecall: params.conversationRecall } : {}),
    ...(params?.activeProjectKeys ? { activeProjectKeys: params.activeProjectKeys } : {}),
  });
  if (!tool) {
    throw new Error("tool missing");
  }
  return tool;
}

export function createMemoryGetToolOrThrow(
  config: OmnipolymathConfig = createDefaultMemoryToolConfig(),
) {
  const tool = createMemoryGetTool({ config });
  if (!tool) {
    throw new Error("tool missing");
  }
  return tool;
}

export function expectUnavailableMemorySearchDetails(
  details: unknown,
  params: {
    error: string;
    warning: string;
    action: string;
    timeoutMs?: number;
  },
) {
  expect(details).toEqual({
    results: [],
    disabled: true,
    unavailable: true,
    ...(params.timeoutMs === undefined ? {} : { timedOut: true, timeoutMs: params.timeoutMs }),
    error: params.error,
    warning: params.warning,
    action: params.action,
    debug: {
      warning: params.warning,
      action: params.action,
      error: params.error,
    },
  });
}
