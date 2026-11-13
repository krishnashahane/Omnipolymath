import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";

export function createReplyAgentDefaults(workspace: string) {
  return {
    workspace,
    skipBootstrap: true,
    model: { primary: "mock-openai/gpt-5.6-luna" },
    models: { "mock-openai/gpt-5.6-luna": { agentRuntime: { id: "omnipolymath" as const } } },
  };
}

export function withVerboseDefault(config: OmnipolymathConfig) {
  return { ...config, agents: { defaults: { verboseDefault: "on" as const } } };
}
