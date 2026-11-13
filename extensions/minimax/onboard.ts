import { findNormalizedProviderValue } from "omnipolymath/plugin-sdk/provider-auth";
import {
  applyAgentDefaultModelPrimary,
  applyOnboardAuthAgentModelsAndProviders,
  type ModelProviderConfig,
  type OmnipolymathConfig,
} from "omnipolymath/plugin-sdk/provider-onboard";
import {
  buildMinimaxApiModelDefinition,
  MINIMAX_API_BASE_URL,
  MINIMAX_CN_API_BASE_URL,
} from "./model-definitions.js";
import { MINIMAX_DEFAULT_MODEL_ID } from "./provider-models.js";

function applyMinimaxApiProviderConfigWithBaseUrl(
  cfg: OmnipolymathConfig,
  modelId: string,
  baseUrl: string,
): OmnipolymathConfig {
  const providers = { ...cfg.models?.providers } as Record<string, ModelProviderConfig>;
  const existingProvider = providers.minimax ?? findNormalizedProviderValue(providers, "minimax");
  const existingModels = existingProvider?.models ?? [];
  const apiModel = buildMinimaxApiModelDefinition(modelId);
  const hasApiModel = existingModels.some((model) => model.id === modelId);
  const mergedModels = hasApiModel ? existingModels : [...existingModels, apiModel];
  const { apiKey: existingApiKey, ...existingProviderRest } = existingProvider ?? {
    baseUrl,
    models: [],
  };
  const preservedApiKey =
    typeof existingApiKey === "string"
      ? existingApiKey.trim() === "" || existingApiKey.trim() === "minimax"
        ? undefined
        : existingApiKey
      : existingApiKey;
  providers.minimax = {
    ...existingProviderRest,
    baseUrl,
    api: "anthropic-messages",
    authHeader: true,
    ...(preservedApiKey ? { apiKey: preservedApiKey } : {}),
    models: mergedModels,
  };

  const models = { ...cfg.agents?.defaults?.models };
  const modelRef = `minimax/${modelId}`;
  models[modelRef] = {
    ...models[modelRef],
    alias: "Minimax",
  };

  return applyOnboardAuthAgentModelsAndProviders(cfg, { agentModels: models, providers });
}

function createMinimaxApiConfigPair(baseUrl: string) {
  const provider = (cfg: OmnipolymathConfig, modelId = MINIMAX_DEFAULT_MODEL_ID): OmnipolymathConfig =>
    applyMinimaxApiProviderConfigWithBaseUrl(cfg, modelId, baseUrl);
  const defaults = (cfg: OmnipolymathConfig, modelId = MINIMAX_DEFAULT_MODEL_ID): OmnipolymathConfig =>
    applyAgentDefaultModelPrimary(provider(cfg, modelId), `minimax/${modelId}`);
  return { provider, defaults };
}

const globalApiConfig = createMinimaxApiConfigPair(MINIMAX_API_BASE_URL);
const cnApiConfig = createMinimaxApiConfigPair(MINIMAX_CN_API_BASE_URL);
export const applyMinimaxApiProviderConfig = globalApiConfig.provider;
export const applyMinimaxApiConfig = globalApiConfig.defaults;
export const applyMinimaxApiProviderConfigCn = cnApiConfig.provider;
export const applyMinimaxApiConfigCn = cnApiConfig.defaults;
