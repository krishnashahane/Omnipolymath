/** Canonical opt-in for Omnipolymath ID runtime and presentation boundaries. */
export function isOmnipolymathIdEnabled(config: { enabled?: boolean } | undefined): boolean {
  return config?.enabled === true;
}

/** Feature-owned plugin surfaces are absent until their owning feature is enabled. */
export function isOmnipolymathIdPluginVisible(
  pluginId: string,
  config: { gateway?: { omnipolymathId?: { enabled?: boolean } } } | null | undefined,
): boolean {
  return pluginId !== "omnipolymath-id-access" || isOmnipolymathIdEnabled(config?.gateway?.omnipolymathId);
}

/** A list filter that drops feature-owned plugins while their feature is off. */
export function idFeatureVisible(
  config: Parameters<typeof isOmnipolymathIdPluginVisible>[1],
): (plugin: { id: string }) => boolean {
  return (plugin) => isOmnipolymathIdPluginVisible(plugin.id, config);
}
