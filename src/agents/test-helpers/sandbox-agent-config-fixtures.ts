/**
 * Sandbox agent config fixtures.
 *
 * Builds restricted agent configs for sandbox tool-policy and workspace tests.
 */
import type { AgentConfig } from "../../config/types.agents.js";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";

type AgentToolsConfig = AgentConfig["tools"];
type SandboxToolsConfig = {
  allow?: string[];
  deny?: string[];
};

export function createRestrictedAgentSandboxConfig(params: {
  agentTools?: AgentToolsConfig;
  globalSandboxTools?: SandboxToolsConfig;
  workspace?: string;
}): OmnipolymathConfig {
  return {
    agents: {
      defaults: {
        sandbox: {
          mode: "all",
          scope: "agent",
        },
      },
      entries: {
        restricted: {
          workspace: params.workspace ?? "~/omnipolymath-restricted",
          sandbox: {
            mode: "all",
            scope: "agent",
          },
          ...(params.agentTools ? { tools: params.agentTools } : {}),
        },
      },
    },
    ...(params.globalSandboxTools
      ? {
          tools: {
            sandbox: {
              tools: params.globalSandboxTools,
            },
          },
        }
      : {}),
  } as OmnipolymathConfig;
}
