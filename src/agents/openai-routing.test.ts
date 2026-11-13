import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OmnipolymathConfigWithLegacyRoster } from "../config/legacy.roster.js";
import type { ModelApi } from "../config/types.models.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import {
  modelSelectionShouldEnsureCodexPlugin,
  resolveOpenAIImplicitAgentRuntime,
} from "./openai-routing.js";

function implicit(params: Parameters<typeof resolveOpenAIImplicitAgentRuntime>[0] = {}) {
  return resolveOpenAIImplicitAgentRuntime({ provider: "openai", env: {}, ...params });
}

function ensure(config?: OmnipolymathConfigWithLegacyRoster, agentId?: string) {
  return modelSelectionShouldEnsureCodexPlugin({ model: "openai/gpt-5.5", config, agentId });
}

function providerConfig(baseUrl: string, api?: ModelApi): OmnipolymathConfig {
  return { models: { providers: { openai: { baseUrl, api, models: [] } } } };
}

function expectImplicit(
  params: Parameters<typeof implicit>[0],
  runtime: ReturnType<typeof implicit> = "codex",
) {
  expect(implicit(params)).toBe(runtime);
}

describe("OpenAI runtime routing policy", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_BASE_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Codex by default for official OpenAI agent model selections", () => {
    expect(implicit()).toBe("codex");
    expect(implicit({ modelId: "gpt-5.4-nano" })).toBe("codex");
    expect(ensure({})).toBe(true);
  });

  it("keeps Codex for model-scoped thinking controls", () => {
    const config: OmnipolymathConfig = {
      agents: { defaults: { models: { "openai/gpt-5.6-sol": { params: { thinking: "xhigh" } } } } },
    };
    expectImplicit({ modelId: "gpt-5.6-sol", config });
  });

  it("maps provider route facts onto a closed implicit runtime", () => {
    expectImplicit({ modelId: "gpt-5.6" });
    expectImplicit({
      api: "openai-chatgpt-responses",
      baseUrl: "https://chatgpt.com/backend-api/codex/responses",
    });
    expectImplicit(
      {
        modelId: "gpt-5.5",
        config: providerConfig("https://api.openai.com/v1", "openai-completions"),
      },
      "omnipolymath",
    );
    expectImplicit({ baseUrl: "https://direct.example.test/v1" }, "omnipolymath");
  });

  it("fails closed to Omnipolymath when the provider artifact is unavailable", () => {
    vi.stubEnv("OMNIPOLYMATH_DISABLE_BUNDLED_PLUGINS", "1");
    expect(resolveOpenAIImplicitAgentRuntime({ provider: "openai", modelId: "gpt-5.5" })).toBe(
      "omnipolymath",
    );
    expect(ensure()).toBe(false);
  });

  it("does not force Codex for custom OpenAI-compatible base URLs", () => {
    const config = providerConfig("https://example.test/v1");

    expect(resolveOpenAIImplicitAgentRuntime({ provider: "openai", config })).toBe("omnipolymath");
    expect(ensure(config)).toBe(false);
  });

  it("uses the configured fixed-store owner for agent-scoped request parameters", () => {
    const config = {
      session: { store: "/stores/shared.sqlite" },
      agents: {
        ownership: "explicit",
        defaults: { sessionStore: { agentId: "research" } },
        entries: {
          ops: {},
          research: { params: { store: false } },
        },
      },
    } satisfies OmnipolymathConfig;

    const params = { modelId: "gpt-5.5", config, sessionKey: "global" };
    expectImplicit(params, "omnipolymath");
    expect(() => implicit({ ...params, agentId: "ops" })).toThrow(/belongs to "research"/);
  });

  it("honors explicit model runtime policy before the OpenAI base URL default", () => {
    const customCodexConfig = {
      ...providerConfig("https://example.test/v1"),
      agents: {
        defaults: {
          models: {
            "openai/gpt-5.5": { agentRuntime: { id: "codex" } },
          },
        },
      },
    } satisfies OmnipolymathConfig;
    const officialOmnipolymathConfig = {
      agents: {
        defaults: {
          models: {
            "openai/gpt-5.5": { agentRuntime: { id: "omnipolymath" } },
          },
        },
      },
    } satisfies OmnipolymathConfig;

    expect(ensure(customCodexConfig)).toBe(true);
    expect(ensure(officialOmnipolymathConfig)).toBe(false);
  });

  it("honors the deprecated whole-agent Omnipolymath runtime opt-out", () => {
    const config = {
      agents: {
        defaults: { agentRuntime: { id: "omnipolymath" } },
        entries: { worker: { agentRuntime: { id: "omnipolymath" } } },
      },
    } satisfies OmnipolymathConfigWithLegacyRoster;

    expect(ensure(config)).toBe(false);
    expect(ensure(config, "worker")).toBe(false);
  });

  it("keeps per-model auto policy above the whole-agent Omnipolymath opt-out", () => {
    const config = {
      agents: {
        defaults: {
          agentRuntime: { id: "omnipolymath" },
          models: {
            "openai/gpt-5.5": { agentRuntime: { id: "auto" } },
          },
        },
      },
    } satisfies OmnipolymathConfigWithLegacyRoster;

    expect(ensure(config)).toBe(true);
  });
});
