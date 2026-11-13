import type { AgentSandboxConfig } from "../../config/types.agents-shared.js";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import { resolveSandboxContext } from "./context.js";
import { resolvePreparedSandboxRuntimeStatus } from "./runtime-status.js";
export { acquireSandboxGatewayOwner as acquireOwner } from "./registry.test-support.js";

export function createConfig(
  sandbox: AgentSandboxConfig,
  config: OmnipolymathConfig = {},
): OmnipolymathConfig {
  return {
    ...config,
    agents: {
      defaults: {
        ...config.agents?.defaults,
        sandbox: {
          mode: "all",
          workspaceAccess: "rw",
          prune: { idleHours: 0, maxAgeDays: 0 },
          ...sandbox,
        },
      },
    },
  };
}

export function prepareContext(config: OmnipolymathConfig, sessionKey: string, workspaceDir: string) {
  return resolveSandboxContext({
    config,
    sessionKey,
    workspaceDir,
    preparedRuntimeStatus: resolvePreparedSandboxRuntimeStatus({
      cfg: config,
      sessionKey,
      preparedSessionEntry: null,
    }),
  });
}
