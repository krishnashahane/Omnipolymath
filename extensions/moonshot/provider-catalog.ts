import {
  buildManifestModelProviderConfig,
  readManifestProviderDefaultModelRef,
} from "omnipolymath/plugin-sdk/provider-catalog-shared";
import type { ModelProviderConfig } from "omnipolymath/plugin-sdk/provider-model-shared";
import manifest from "./omnipolymath.plugin.json" with { type: "json" };

export {
  isNativeMoonshotBaseUrl,
  MOONSHOT_BASE_URL,
  MOONSHOT_CN_BASE_URL,
} from "./provider-policy-api.js";
export const MOONSHOT_DEFAULT_MODEL_REF = readManifestProviderDefaultModelRef(
  manifest,
  "moonshot",
)!;
export const MOONSHOT_DEFAULT_MODEL_ID = MOONSHOT_DEFAULT_MODEL_REF.slice("moonshot/".length);

export function buildMoonshotProvider(): ModelProviderConfig {
  return buildManifestModelProviderConfig({
    providerId: "moonshot",
    catalog: manifest.modelCatalog.providers.moonshot,
  });
}
