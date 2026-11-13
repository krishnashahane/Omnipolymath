import type { OmnipolymathConfig } from "../../../../src/config/types.omnipolymath.js";

export function withFixturePlugin(
  config: OmnipolymathConfig,
  pluginDir: string,
  pluginId: string,
): OmnipolymathConfig {
  return {
    ...config,
    plugins: {
      ...config.plugins,
      enabled: true,
      allow: [...new Set([...(config.plugins?.allow ?? []), pluginId])],
      load: {
        ...config.plugins?.load,
        paths: [...new Set([...(config.plugins?.load?.paths ?? []), pluginDir])],
      },
      entries: {
        ...config.plugins?.entries,
        [pluginId]: { enabled: true },
      },
    },
  };
}
