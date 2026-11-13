import type { OmnipolymathPluginApi } from "./plugin-api.types.js";
import type { OmnipolymathPluginConfigSchema } from "./plugin-config-schema.types.js";
import type { PluginKind } from "./plugin-kind.types.js";
import type {
  OmnipolymathPluginReloadRegistration,
  OmnipolymathPluginSecurityAuditCollector,
} from "./plugin-registration.types.js";
import type { OmnipolymathPluginNodeHostCommand } from "./types.node-host.js";

/** Module-level plugin definition loaded from a native plugin entry file. */
export type OmnipolymathPluginDefinition = {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  /**
   * @deprecated Declare exclusive plugin kind in `omnipolymath.plugin.json` via
   * manifest `kind`. Runtime-exported `kind` is kept as a compatibility
   * fallback for older plugins and may require loading plugin runtime on
   * metadata-only command paths.
   */
  kind?: PluginKind | PluginKind[];
  configSchema?: OmnipolymathPluginConfigSchema;
  reload?: OmnipolymathPluginReloadRegistration;
  nodeHostCommands?: OmnipolymathPluginNodeHostCommand[];
  securityAuditCollectors?: OmnipolymathPluginSecurityAuditCollector[];
  register?: (api: OmnipolymathPluginApi) => void;
};

export type OmnipolymathPluginModule = OmnipolymathPluginDefinition | ((api: OmnipolymathPluginApi) => void);
