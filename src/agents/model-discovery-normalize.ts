/** Applies the same provider normalization to registry and live-test models. */
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import type { Model } from "../llm/types.js";
import type { PluginMetadataSnapshotOwnerMaps } from "../plugins/plugin-metadata-snapshot.types.js";
import { normalizeModelCompat } from "../plugins/provider-model-compat.js";
import {
  applyProviderResolvedTransportWithPlugin,
  normalizeProviderResolvedModelWithPlugin,
} from "../plugins/provider-runtime.js";

type NormalizeDiscoveredModelOptions = {
  config?: OmnipolymathConfig;
  workspaceDir?: string;
  providerMetadataOwners?: PluginMetadataSnapshotOwnerMaps;
};

/** Applies plugin model normalization and transport hooks to discovered agent models. */
export function normalizeDiscoveredAgentModel(
  model: Model,
  agentDir: string,
  options?: NormalizeDiscoveredModelOptions,
): Model {
  const runtimeContext = {
    ...(options?.config !== undefined ? { config: options.config } : {}),
    ...(options?.workspaceDir !== undefined ? { workspaceDir: options.workspaceDir } : {}),
  };
  const pluginNormalized =
    normalizeProviderResolvedModelWithPlugin({
      provider: model.provider,
      ...runtimeContext,
      context: {
        provider: model.provider,
        modelId: model.id,
        model,
        agentDir,
      },
    }) ?? model;
  const transportNormalized =
    applyProviderResolvedTransportWithPlugin({
      provider: model.provider,
      ...runtimeContext,
      context: {
        provider: model.provider,
        modelId: model.id,
        model: pluginNormalized,
        agentDir,
      },
    }) ?? pluginNormalized;
  return normalizeModelCompat(transportNormalized, options?.providerMetadataOwners);
}
