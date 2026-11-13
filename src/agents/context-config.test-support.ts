import type { ModelDefinitionConfig } from "../config/types.models.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { buildCatalogModel } from "../plugin-sdk/provider-catalog.test-support.js";

export function modelConfig(
  provider: string,
  id: string,
  limits: Partial<Pick<ModelDefinitionConfig, "contextWindow" | "contextTokens">>,
): OmnipolymathConfig {
  const model: ModelDefinitionConfig = buildCatalogModel(id, {
    contextWindow: 200_000,
    maxTokens: 4096,
    ...limits,
  });
  return {
    models: { providers: { [provider]: { baseUrl: "https://example.invalid", models: [model] } } },
  };
}
