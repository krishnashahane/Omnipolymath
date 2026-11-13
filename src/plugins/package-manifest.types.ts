import type { ChannelMeta } from "../channels/plugins/channel-meta.types.js";
import type { ChannelSetupMetadata } from "../channels/plugins/setup-contract.js";
import type { MANIFEST_KEY } from "../compat/legacy-names.js";
import type { PluginManifestChannelCommandDefaults } from "./manifest-types.js";

/** package.json Omnipolymath metadata used for plugin setup and catalog discovery. */
export type PluginPackageChannel = Partial<Omit<ChannelMeta, "id">> & {
  id?: string;
  /** Closed manifest flags for approval behavior available before the channel runtime loads. */
  approvalFlags?: readonly "native"[];
  commands?: PluginManifestChannelCommandDefaults;
  configuredState?: {
    specifier?: string;
    exportName?: string;
    env?: {
      allOf?: readonly string[];
      anyOf?: readonly string[];
    };
  };
  persistedAuthState?: {
    specifier?: string;
    exportName?: string;
    /** Awaited checker preferred by runtime discovery; the synchronous export remains for older hosts. */
    exportNameAsync?: string;
    backingStore?: "plugin-state";
  };
  doctorCapabilities?: PluginPackageChannelDoctorCapabilities;
  /** Typed, serializable setup fields available before plugin runtime load. */
  setup?: ChannelSetupMetadata;
  /** @deprecated Use setup.fields. */
  cliAddOptions?: readonly PluginPackageChannelCliOption[];
};

export type PluginPackageChannelDoctorCapabilities = {
  dmAllowFromMode?: "topOnly" | "topOrNested" | "nestedOnly";
  /** Whether dmPolicy="open" requires an explicit "*" in allowFrom. Defaults to true. */
  openDmRequiresAllowFromWildcard?: boolean;
  groupModel?: "sender" | "route" | "hybrid";
  groupAllowFromFallbackToAllowFrom?: boolean;
  warnOnEmptyGroupSenderAllowlist?: boolean;
};

export type PluginPackageChannelCliOption = ChannelSetupMetadata["fields"][number]["cli"] & {
  valueType?: "int" | "list";
};

export type PluginPackageInstall = {
  clawhubSpec?: string;
  npmSpec?: string;
  localPath?: string;
  defaultChoice?: "clawhub" | "npm" | "local";
  minHostVersion?: string;
  expectedIntegrity?: string;
  allowInvalidConfigRecovery?: boolean;
  requiredPlatformPackages?: string[];
};

type OmnipolymathPackageSetupFeatures = {
  configPromotion?: boolean | "preserve-root";
  /**
   * @deprecated Declare doctorContract.stateMigrations in omnipolymath.plugin.json instead.
   * Removal plan: remove the setup-entry adapter after the 2027.1 external-plugin migration window.
   */
  legacyStateMigrations?: boolean;
  legacySessionSurfaces?: boolean;
};

type OmnipolymathPackageCompat = {
  pluginApi?: string;
  minGatewayVersion?: string;
};

export type OmnipolymathPackageBuild = {
  bundledDist?: boolean;
  omnipolymathVersion?: string;
  pluginSdkVersion?: string;
};

export type OmnipolymathPackageManifest = {
  extensions?: string[];
  runtimeExtensions?: string[];
  setupEntry?: string;
  runtimeSetupEntry?: string;
  controlUi?: string;
  setupFeatures?: OmnipolymathPackageSetupFeatures;
  plugin?: {
    id?: string;
    label?: string;
  };
  channel?: PluginPackageChannel;
  compat?: OmnipolymathPackageCompat;
  install?: PluginPackageInstall;
  build?: OmnipolymathPackageBuild;
};

export type PackageExtensionResolution =
  | { status: "ok"; entries: string[] }
  | { status: "missing"; entries: [] }
  | { status: "empty"; entries: [] }
  | { status: "invalid"; entries: []; error: string };

export type PackageManifest = {
  name?: string;
  version?: string;
  description?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
} & Partial<Record<typeof MANIFEST_KEY, OmnipolymathPackageManifest>>;
