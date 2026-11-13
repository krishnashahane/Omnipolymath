import type { ModelCostConfig } from "@omnipolymath/llm-core";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { prepareModelPricingContext } from "../model-catalog/pricing.js";
import { getAsyncWorkSignal } from "../shared/async-work-scope.js";
import {
  captureModelCostPricing,
  resolveModelCostConfigFingerprint,
  type CapturedModelCostPricing,
} from "../utils/usage-format.js";
import { racePromiseWithAbortSignal } from "./abort-signal.js";
import {
  applyUsageCostEstimate,
  needsUsageCostEstimate,
  parseUsageCostTranscriptRecord,
  type UsageCostResolver,
} from "./session-cost-usage-pricing.js";
import type { ParsedTranscriptEntry } from "./session-cost-usage.types.js";

export async function resolveUsageCostPricingFingerprint(
  config?: OmnipolymathConfig,
  agentDir?: string,
): Promise<string> {
  await prepareModelPricingContext(config);
  return resolveModelCostConfigFingerprint(config, agentDir);
}

export async function prepareUsageCostPricing(
  config?: OmnipolymathConfig,
  agentDir?: string,
): Promise<CapturedModelCostPricing> {
  // Catalog preparation can be shared and outlive this refresh; shutdown must
  // release its usage lock without waiting for optional pricing metadata.
  await racePromiseWithAbortSignal(
    () => prepareModelPricingContext(config),
    getAsyncWorkSignal(),
    (aborted) => aborted.reason,
  );
  return captureModelCostPricing(config, agentDir);
}

export function createUsageCostResolver(
  params?: { config?: OmnipolymathConfig; agentDir?: string },
  pricing?: CapturedModelCostPricing,
): UsageCostResolver {
  let capturedPricing = pricing;
  const cache = new Map<string, ModelCostConfig | undefined>();
  return ({ provider, model }) => {
    const key = `${provider ?? ""}\0${model ?? ""}`;
    if (cache.has(key)) {
      return cache.get(key);
    }
    // Diagnostic readers enter pricing only after the first unpriced record is prepared.
    capturedPricing ??= captureModelCostPricing(params?.config, params?.agentDir);
    const cost = capturedPricing.resolve(provider, model);
    cache.set(key, cost);
    return cost;
  };
}

/** Diagnostic readers prepare only when a record actually needs an estimate. */
export async function parseUsageCostTranscriptEntryAsync(
  parsed: Record<string, unknown>,
  resolveCost: UsageCostResolver,
  config?: OmnipolymathConfig,
): Promise<ParsedTranscriptEntry | null> {
  const entry = parseUsageCostTranscriptRecord(parsed);
  if (!needsUsageCostEstimate(entry)) {
    return entry;
  }
  await prepareModelPricingContext(config);
  return applyUsageCostEstimate(entry, resolveCost);
}
