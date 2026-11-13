import { asOptionalRecord } from "@omnipolymath/normalization-core/record-coerce";
import { isDeeplyFrozenPlainData } from "../shared/immutable-data.js";
import { getConfigResolutionFacts } from "./resolution-facts.js";
import {
  captureRuntimeConfigWithSource,
  getPublishedRuntimeConfigSource,
  getRuntimeConfigCapture,
} from "./runtime-config-capture-state.js";
import { getRuntimeConfigSnapshot, getRuntimeConfigSourceSnapshot } from "./runtime-snapshot.js";
import { projectRuntimeChangesOntoSource } from "./source-value-projection.js";
import type { OmnipolymathConfig } from "./types.js";

const immutableCaptures = new WeakMap<OmnipolymathConfig, OmnipolymathConfig>();

/** Captures runtime and authored values together for one admitted preparation generation. */
export function captureRuntimeConfig(config: OmnipolymathConfig): OmnipolymathConfig {
  if (config === getRuntimeConfigSnapshot()) {
    return getRuntimeConfigSnapshot({ capture: true })!;
  }
  if (getRuntimeConfigCapture(config)) {
    return config;
  }
  const source = projectConfigOntoRuntimeSourceSnapshot(config);
  // Standalone captures can follow immutable inputs. Publications own their capture
  // separately; memoizing by their live origin would retain retired full config copies.
  const reusable = config === source && isDeeplyFrozenPlainData(config);
  const previous = reusable ? immutableCaptures.get(config) : undefined;
  if (previous && getConfigResolutionFacts(previous) === getConfigResolutionFacts(config)) {
    return previous;
  }
  const captured = captureRuntimeConfigWithSource(config, source);
  if (reusable) {
    immutableCaptures.set(config, captured);
  }
  return captured;
}

/** Projects a runtime-derived config back onto the active authored source snapshot. */
export function projectConfigOntoRuntimeSourceSnapshot(config: OmnipolymathConfig): OmnipolymathConfig {
  const captured = getRuntimeConfigCapture(config);
  if (captured) {
    return captured.source;
  }
  const published = getPublishedRuntimeConfigSource(config);
  if (published) {
    return published;
  }
  const runtimeConfigSnapshot = getRuntimeConfigSnapshot();
  const runtimeConfigSourceSnapshot = getRuntimeConfigSourceSnapshot();
  if (!runtimeConfigSnapshot || !runtimeConfigSourceSnapshot) {
    return config;
  }
  if (config === runtimeConfigSnapshot) {
    return runtimeConfigSourceSnapshot;
  }
  const runtime = runtimeConfigSnapshot as Record<string, unknown>;
  const candidate = config as Record<string, unknown>;
  for (const key of Object.keys(runtime)) {
    if (!Object.hasOwn(candidate, key)) {
      return config;
    }
    const runtimeValue = runtime[key];
    const candidateValue = candidate[key];
    if (
      Array.isArray(runtimeValue) !== Array.isArray(candidateValue) ||
      (runtimeValue === null) !== (candidateValue === null) ||
      typeof runtimeValue !== typeof candidateValue
    ) {
      return config;
    }
  }
  return projectRuntimeChangesOntoSource(
    runtimeConfigSourceSnapshot,
    runtimeConfigSnapshot,
    config,
  ) as OmnipolymathConfig;
}

/** Projects partial legacy inputs without persisting deleted runtime-only parents. */
export function projectLegacyRuntimeConfigWrite(
  config: OmnipolymathConfig,
  runtimeSnapshot = getRuntimeConfigSnapshot(),
  sourceSnapshot = getRuntimeConfigSourceSnapshot(),
): OmnipolymathConfig {
  if (!runtimeSnapshot || !sourceSnapshot) {
    return config;
  }
  // Legacy partial writes alone omit parents created only by removing runtime defaults.
  return (asOptionalRecord(
    projectRuntimeChangesOntoSource(sourceSnapshot, runtimeSnapshot, config, {
      pruneUnauthoredDeletions: true,
    }),
  ) ?? {}) as OmnipolymathConfig;
}
