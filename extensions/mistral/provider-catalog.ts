import { buildManifestModelProviderConfig } from "omnipolymath/plugin-sdk/provider-catalog-shared";
import type { ModelProviderConfig } from "omnipolymath/plugin-sdk/provider-model-shared";
import manifest from "./omnipolymath.plugin.json" with { type: "json" };

export function buildMistralProvider(): ModelProviderConfig {
  return buildManifestModelProviderConfig({
    providerId: "mistral",
    catalog: manifest.modelCatalog.providers.mistral,
  });
}
