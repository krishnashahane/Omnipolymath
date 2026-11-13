import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import type { ModelProviderConfig } from "omnipolymath/plugin-sdk/provider-model-shared";
import { LLAMA_CPP_PROVIDER_ID } from "./defaults.js";

export const MANAGED_LLAMA_CPP_CONFIG_REQUIRED_MESSAGE =
  "Local embeddings need the managed llama.cpp server config (llama-server). The in-process node-llama-cpp runtime was removed; semantic memory recall is degraded until setup. Run `omnipolymath configure`, choose llama.cpp once, then retry `omnipolymath memory status --deep`.";

export function resolveManagedLlamaCppProviderConfig(config: OmnipolymathConfig): ModelProviderConfig {
  const provider = config.models?.providers?.[LLAMA_CPP_PROVIDER_ID];
  if (!provider?.localService || !provider.baseUrl) {
    throw new Error(MANAGED_LLAMA_CPP_CONFIG_REQUIRED_MESSAGE);
  }
  return provider;
}
