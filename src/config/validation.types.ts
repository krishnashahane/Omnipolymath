import type { PluginManifestRegistry } from "../plugins/manifest-registry.types.js";
import type { ConfigValidationIssue, OmnipolymathConfig } from "./types.omnipolymath.js";

export type ValidateConfigWithPluginsResult =
  | {
      ok: true;
      config: OmnipolymathConfig;
      warnings: ConfigValidationIssue[];
      strictIssues?: ConfigValidationIssue[];
    }
  | { ok: false; issues: ConfigValidationIssue[]; warnings: ConfigValidationIssue[] };

export type PreparedConfigValidationPluginMetadata = {
  manifestRegistry: PluginManifestRegistry;
  installedPluginRecordIds: ReadonlySet<string>;
};
