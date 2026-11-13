import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import type { PluginCache } from "./plugin-cache.types.js";
import type { PluginMetadataSnapshot } from "./plugin-metadata-snapshot.types.js";

export type PluginMetadataSnapshotCandidate = {
  snapshot: PluginMetadataSnapshot | undefined;
  configFingerprint: string | undefined;
  envFingerprint?: string;
  defaultDiscoveryCompatible?: boolean;
  compatibleConfigFingerprints?: readonly string[];
  hasConfigIdentity?: (config: OmnipolymathConfig) => boolean;
  immutableRuntimeGeneration?: boolean;
};

export type ScopedPluginMetadataSnapshot = PluginMetadataSnapshotCandidate & {
  snapshot: PluginMetadataSnapshot;
  cache: PluginCache;
  metadata: PluginCache["metadata"];
  parent?: ScopedPluginMetadataSnapshot;
};
