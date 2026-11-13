/** Model-selection config fixtures for fallback and off-catalog routes. */
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";

export function createFixtureRouteModels(): OmnipolymathConfig["models"] {
  return {
    providers: {
      "fixture-route": {
        api: "openai-responses",
        baseUrl: "https://fixture.invalid/v1",
        models: [],
      },
    },
  };
}

export function makeModelFallbackCfg(overrides: Partial<OmnipolymathConfig> = {}): OmnipolymathConfig {
  return {
    agents: {
      defaults: {
        model: {
          primary: "openai/gpt-4.1-mini",
          fallbacks: ["anthropic/claude-haiku-3-5"],
        },
      },
    },
    ...overrides,
  } as OmnipolymathConfig;
}

export function createModelFallbackConfig(primary: string, fallbacks: string[]): OmnipolymathConfig {
  return {
    agents: {
      defaults: {
        model: { primary, fallbacks },
      },
    },
  };
}

export function createFixtureProviderModels(baseUrl: string): OmnipolymathConfig["models"] {
  return { providers: { fixture: { api: "openai-completions", baseUrl, models: [] } } };
}
