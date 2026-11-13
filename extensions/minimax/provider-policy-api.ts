// MiniMax policy module exposes static provider policy before runtime registration.
import type { ProviderDefaultThinkingPolicyContext } from "omnipolymath/plugin-sdk/core";
import { resolveMinimaxFastModelId } from "omnipolymath/plugin-sdk/provider-model-metadata";
import type { ProviderFastModePolicyContext } from "omnipolymath/plugin-sdk/provider-model-types";
import { resolveMinimaxThinkingProfile } from "./thinking.js";

export function resolveFastModeSupport(ctx: ProviderFastModePolicyContext): boolean | undefined {
  if (!ctx.api || ctx.runtimeId !== "omnipolymath") {
    return undefined;
  }
  return (
    resolveMinimaxFastModelId({ id: ctx.modelId, provider: ctx.provider, api: ctx.api }) !==
    undefined
  );
}

export function resolveThinkingProfile(context: ProviderDefaultThinkingPolicyContext) {
  return resolveMinimaxThinkingProfile(context.modelId);
}
