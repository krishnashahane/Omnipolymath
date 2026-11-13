import { buildManifestModelProviderConfig } from "omnipolymath/plugin-sdk/provider-catalog-shared";
import type { ModelProviderConfig } from "omnipolymath/plugin-sdk/provider-model-shared";
import manifest from "./omnipolymath.plugin.json" with { type: "json" };

export function buildTogetherProvider(): ModelProviderConfig {
  return buildManifestModelProviderConfig({
    providerId: "together",
    catalog: manifest.modelCatalog.providers.together,
  });
}
