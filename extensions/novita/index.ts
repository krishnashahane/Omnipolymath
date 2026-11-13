import { readConfiguredProviderCatalogEntries } from "omnipolymath/plugin-sdk/provider-catalog-shared";
import { defineSingleProviderPluginEntry } from "omnipolymath/plugin-sdk/provider-entry";
import { buildProviderReplayFamilyHooks } from "omnipolymath/plugin-sdk/provider-model-shared";
import { buildProviderToolCompatFamilyHooks } from "omnipolymath/plugin-sdk/provider-tools";
import manifest from "./omnipolymath.plugin.json" with { type: "json" };
import { buildNovitaVideoGenerationProvider } from "./video-generation-provider.js";

const PROVIDER_ID = "novita";

export default defineSingleProviderPluginEntry({
  id: PROVIDER_ID,
  name: "NovitaAI Provider",
  description: "Official Omnipolymath NovitaAI provider plugin",
  manifest,
  provider: {
    label: "NovitaAI",
    docsPath: "/providers/novita",
    aliases: ["novita-ai", "novitaai"],
    manifestAuth: {
      noteTitle: "NovitaAI",
      noteMessage: "Manage API keys at https://novita.ai/settings/key-management",
    },
    catalog: {
      discoveryMode: "strict",
      allowExplicitBaseUrl: true,
      liveModelDiscovery: true,
    },
    augmentModelCatalog: ({ config }) =>
      readConfiguredProviderCatalogEntries({
        config,
        providerId: PROVIDER_ID,
      }),
    ...buildProviderReplayFamilyHooks({
      family: "openai-compatible",
      dropReasoningFromHistory: false,
    }),
    ...buildProviderToolCompatFamilyHooks("openai"),
  },
  register(api) {
    api.registerVideoGenerationProvider(buildNovitaVideoGenerationProvider());
  },
});
