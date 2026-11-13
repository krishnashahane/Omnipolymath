const OMNIPOLYMATH_NATIVE_PLUGIN_PACKAGES = new Set([
  "@omnipolymath/acpx",
  "@omnipolymath/cloudflare",
  "@omnipolymath/diffs",
  "@omnipolymath/feishu",
]);

/**
 * @param {string} packageName
 * @returns {"" | "code-plugin"}
 */
export function resolveOmnipolymathClawHubPackageFamily(packageName) {
  return OMNIPOLYMATH_NATIVE_PLUGIN_PACKAGES.has(packageName) ? "code-plugin" : "";
}
