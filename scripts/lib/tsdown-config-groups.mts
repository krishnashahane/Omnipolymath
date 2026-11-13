// Full builds compile the shared declaration graph once; CI can select SDK roots only.
export const TSDOWN_PACKAGE_CONFIG_GROUP = "omnipolymath-packages";
export const TSDOWN_UNIFIED_CONFIG_GROUP = "omnipolymath-unified";
export const TSDOWN_UNIFIED_DTS_CONFIG_GROUPS = ["omnipolymath-dts"] as const;
export const TSDOWN_PLUGIN_SDK_DTS_CONFIG_GROUPS = ["omnipolymath-dts-plugin-sdk"] as const;
export const TSDOWN_DECLARATION_CONFIG_GROUPS = [
  ...TSDOWN_UNIFIED_DTS_CONFIG_GROUPS,
  ...TSDOWN_PLUGIN_SDK_DTS_CONFIG_GROUPS,
] as const;
