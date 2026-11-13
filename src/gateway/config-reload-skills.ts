import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { getProcessGatewayPluginMetadataSnapshot } from "../plugins/current-plugin-metadata-state.js";

export async function refreshConfigReloadSkills(config: OmnipolymathConfig): Promise<void> {
  const { refreshSkillsDiscovery } = await import("../skills/runtime/refresh.js");
  await refreshSkillsDiscovery({
    config,
    reason: "config-change",
    pluginMetadataSnapshot: getProcessGatewayPluginMetadataSnapshot(),
  });
}
