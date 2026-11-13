import { normalizeProviderId } from "@omnipolymath/model-catalog-core/provider-id";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import { loadPluginManifestRegistryCore } from "../../plugins/manifest-registry.js";
import type { PluginMetadataSnapshot } from "../../plugins/plugin-metadata-snapshot.js";

type ProviderAliasSource = {
  cfg: OmnipolymathConfig;
  metadataSnapshot?: Pick<PluginMetadataSnapshot, "manifestRegistry">;
};

export function createModelCatalogProviderAliasCanonicalizer(params: ProviderAliasSource): {
  ref: <TRef extends { provider: string }>(ref: TRef) => TRef;
} {
  const aliases = new Map<string, string>();
  const plugins =
    params.metadataSnapshot?.manifestRegistry.plugins ??
    loadPluginManifestRegistryCore({ config: params.cfg }).plugins;
  for (const plugin of plugins) {
    for (const [aliasProvider, target] of Object.entries(plugin.modelCatalog?.aliases ?? {})) {
      const alias = normalizeProviderId(aliasProvider);
      const provider = normalizeProviderId(target.provider);
      if (alias && provider) {
        aliases.set(alias, provider);
      }
    }
  }
  return {
    ref: (ref) => {
      const normalizedProvider = normalizeProviderId(ref.provider);
      const canonicalProvider = aliases.get(normalizedProvider) ?? normalizedProvider;
      return canonicalProvider === ref.provider ? ref : { ...ref, provider: canonicalProvider };
    },
  };
}
