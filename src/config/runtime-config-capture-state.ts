import { freezeJsonSnapshot } from "../shared/immutable-data.js";
import { cloneConfigWithResolutionFacts } from "./resolution-facts.js";
import type { OmnipolymathConfig } from "./types.omnipolymath.js";

type RuntimeConfigCapture = Readonly<{
  source: OmnipolymathConfig;
  origin: OmnipolymathConfig;
}>;

const captures = new WeakMap<OmnipolymathConfig, RuntimeConfigCapture>();

export function getRuntimeConfigCapture(
  config: OmnipolymathConfig | undefined,
): RuntimeConfigCapture | undefined {
  return config ? captures.get(config) : undefined;
}

const publishedSources = new WeakMap<OmnipolymathConfig, OmnipolymathConfig>();

/**
 * Record the authored source last published with a runtime config object, without cloning it.
 * Holders of an older generation then project their own source, not a newer one. Unlike a
 * capture, the config stays mutable: callers that need an isolated pair still capture it.
 */
export function recordPublishedRuntimeConfigSource(
  config: OmnipolymathConfig,
  source: OmnipolymathConfig,
): void {
  publishedSources.set(config, source);
}

export function getPublishedRuntimeConfigSource(
  config: OmnipolymathConfig | undefined,
): OmnipolymathConfig | undefined {
  return config ? publishedSources.get(config) : undefined;
}

/** Freeze a selected runtime/source pair before its publication owner yields. */
export function captureRuntimeConfigWithSource(
  config: OmnipolymathConfig,
  source: OmnipolymathConfig,
): OmnipolymathConfig {
  const clone = (value: OmnipolymathConfig) =>
    freezeJsonSnapshot(cloneConfigWithResolutionFacts(value));
  const captured = clone(config);
  const capturedSource = source === config ? captured : clone(source);
  captures.set(captured, {
    source: capturedSource,
    origin: config,
  });
  if (capturedSource !== captured) {
    captures.set(capturedSource, {
      source: capturedSource,
      origin: source,
    });
  }
  return captured;
}

export type CapturedRuntimeConfigRead = { config: OmnipolymathConfig; env: NodeJS.ProcessEnv };
