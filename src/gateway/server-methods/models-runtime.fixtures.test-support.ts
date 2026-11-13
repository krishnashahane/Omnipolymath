import { configForProviders } from "../../agents/model-auth.fixtures.test-support.js";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import type { GatewayAgentRuntime } from "../../shared/session-types.js";

export const EXPECTED_DEMO_IDENTITY = {
  id: "demo-model",
  name: "Demo Model",
  provider: "demo-provider",
};

export function thinkingLevels(levels: string) {
  return levels.split(" ").map((id) => ({ id, label: id }));
}

export function claudeOptOutConfig(modelId: string): OmnipolymathConfig {
  return {
    agents: {
      defaults: { models: { [`anthropic/${modelId}`]: { agentRuntime: { id: "claude-cli" } } } },
    },
    models: configForProviders({
      anthropic: { models: [{ id: modelId, name: modelId, reasoning: false }] },
    }).models,
  } as unknown as OmnipolymathConfig;
}

const OMNIPOLYMATH_DEVICE_PLACEMENT: NonNullable<GatewayAgentRuntime["devicePlacement"]> = {
  requiredNodeCommands: [],
  consumesWorkerSlot: true,
};

export const EXPECTED_IMPLICIT_CODEX_RUNTIME: GatewayAgentRuntime = {
  id: "codex",
  cloudPlacementSupported: false,
  devicePlacementSupported: false,
  source: "implicit",
};

export const EXPECTED_IMPLICIT_OMNIPOLYMATH_RUNTIME: GatewayAgentRuntime = {
  id: "omnipolymath",
  cloudPlacementSupported: true,
  cloudPlacementExecutionMode: "worker-turn",
  devicePlacement: OMNIPOLYMATH_DEVICE_PLACEMENT,
  devicePlacementSupported: true,
  source: "implicit",
};

/** Every row states its runtime; literal rows use the implicit built-in runtime unless they say otherwise. */
export function withStatedRuntime(models: unknown): unknown {
  return Array.isArray(models)
    ? models.map((model: Record<string, unknown>) =>
        typeof model.asymmetricMatch === "function"
          ? model
          : { agentRuntime: EXPECTED_IMPLICIT_OMNIPOLYMATH_RUNTIME, ...model },
      )
    : models;
}
