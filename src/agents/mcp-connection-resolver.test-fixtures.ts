import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { createTestPluginRegistry } from "../plugins/registry-runtime.test-helpers.js";
import { createPluginRecord } from "../plugins/status.test-fixtures.js";

export function createMcpProofPluginRegistry() {
  const pluginRegistry = createTestPluginRegistry();

  return {
    registry: pluginRegistry.registry,
    apiFor: (pluginId: string) => {
      const record = createPluginRecord({
        id: pluginId,
        source: `/plugins/${pluginId}/index.ts`,
      });
      pluginRegistry.registry.plugins.push(record);
      return pluginRegistry.createApi(record, { config: {} as OmnipolymathConfig });
    },
  };
}
