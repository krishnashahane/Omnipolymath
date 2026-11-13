import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import { resolveProviderWebSearchPluginConfig } from "omnipolymath/plugin-sdk/provider-web-search-config-contract";
import { isRecord } from "omnipolymath/plugin-sdk/string-coerce-runtime";

type JsonRecord = Record<string, unknown>;

function baseUrlFallback(config?: JsonRecord): JsonRecord | undefined {
  return typeof config?.baseUrl === "string" && config.baseUrl.trim()
    ? { baseUrl: config.baseUrl }
    : undefined;
}

export function resolveEffectiveXSearchConfig(config?: OmnipolymathConfig): JsonRecord | undefined {
  const pluginWebSearchBaseUrl = baseUrlFallback(
    resolveProviderWebSearchPluginConfig(config, "xai"),
  );
  const pluginOwned = config?.plugins?.entries?.xai?.config?.xSearch;
  const merged = {
    ...pluginWebSearchBaseUrl,
    ...(isRecord(pluginOwned) ? pluginOwned : undefined),
  };
  if (Object.keys(merged).length === 0) {
    return undefined;
  }
  return merged;
}

export function setPluginXSearchConfigValue(
  configTarget: OmnipolymathConfig,
  key: string,
  value: unknown,
): void {
  const plugins = (configTarget.plugins ??= {}) as { entries?: Record<string, unknown> };
  const entries = (plugins.entries ??= {});
  const entry = (entries.xai ??= {}) as { config?: Record<string, unknown> };
  const config = (entry.config ??= {});
  const xSearch = (config.xSearch ??= {}) as Record<string, unknown>;
  xSearch[key] = value;
}
