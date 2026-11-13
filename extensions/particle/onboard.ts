import {
  buildManifestModelProviderConfig,
  readManifestProviderDefaultModelRef,
} from "omnipolymath/plugin-sdk/provider-catalog-shared";
import { createProviderConnectionPresetAppliers } from "omnipolymath/plugin-sdk/provider-onboard";
import manifest from "./omnipolymath.plugin.json" with { type: "json" };

const defaultModelRef = readManifestProviderDefaultModelRef(manifest, "particle")!;

export const { applyConfig: applyParticleConfig } = createProviderConnectionPresetAppliers<[]>({
  primaryModelRef: defaultModelRef,
  resolveParams: () => {
    const provider = buildManifestModelProviderConfig({
      providerId: "particle",
      catalog: manifest.modelCatalog.providers.particle,
    });
    return {
      providerId: "particle",
      api: "openai-completions",
      baseUrl: provider.baseUrl,
      catalogModels: () => provider.models,
      aliases: [{ modelRef: defaultModelRef, alias: "Particle-1" }],
    };
  },
});
