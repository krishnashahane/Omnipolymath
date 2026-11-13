import { normalizeMediaProviderId } from "../../packages/media-understanding-common/src/provider-id.js";
import type { OmnipolymathConfig } from "../config/types.js";
import type { MediaUnderstandingProvider } from "./provider-types.js";

/** Keeps authored provider IDs so callers can project canonical or execution aliases. */
export function listImageCapableConfiguredProviders(cfg?: OmnipolymathConfig): string[] {
  return Object.entries(cfg?.models?.providers ?? {})
    .filter(
      ([id, provider]) =>
        // Config-write secrets preflight reads source config before model defaults.
        id.trim() && (provider.models ?? []).some((model) => model.input?.includes("image")),
    )
    .map(([id]) => id);
}

/** Project static registrations against the caller's config without changing cached providers. */
export function resolveConfiguredMediaProviderCapabilities(
  provider: MediaUnderstandingProvider,
  cfg?: OmnipolymathConfig,
) {
  if (
    provider.inheritConfiguredImageCapability &&
    !provider.capabilities?.includes("image") &&
    listImageCapableConfiguredProviders(cfg).some(
      (id) => normalizeMediaProviderId(id) === normalizeMediaProviderId(provider.id),
    )
  ) {
    return [...(provider.capabilities ?? []), "image" as const];
  }
  return provider.capabilities;
}
