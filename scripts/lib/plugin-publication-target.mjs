/** The source manifest owns publication eligibility, including bundled-only deferral. */
export function isPluginPublicationEnabled(packageJson, target) {
  return (
    packageJson.omnipolymath?.build?.bundledDist !== true &&
    (target === "npm"
      ? packageJson.omnipolymath?.release?.publishToNpm === true
      : packageJson.omnipolymath?.release?.publishToClawHub === true)
  );
}
