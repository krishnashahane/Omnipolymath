import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import { resolveOptionalIntegerOption } from "omnipolymath/plugin-sdk/number-runtime";
import { readRuntimeConfig as getRuntimeConfig } from "omnipolymath/plugin-sdk/runtime-config-snapshot";

export function resolveRuntimeImageSanitization(
  getConfig: () => OmnipolymathConfig = getRuntimeConfig,
): { maxDimensionPx: number } | undefined {
  const maxDimensionPx = resolveOptionalIntegerOption(
    getConfig().agents?.defaults?.imageMaxDimensionPx,
    { min: 1 },
  );
  if (maxDimensionPx === undefined) {
    return undefined;
  }
  return { maxDimensionPx };
}
