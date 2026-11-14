/**
 * Supply-chain checks for plugin installs.
 *
 * The rename from the upstream project changed several vendor package names in
 * the setup catalog to names their vendors never published. Anyone could
 * register such a name, so installing it would run a stranger's code. The same
 * holds for the @omnipolymath scope until this project publishes there: its
 * official plugins ship with the build, so a registry copy is not ours.
 */

/** Renamed vendor packages that exist only in the catalog, never on a registry. */
export const UNVERIFIED_VENDOR_PACKAGES: ReadonlySet<string> = new Set([
  "@tencent-weixin/omnipolymath-weixin",
  "@wecom/wecom-omnipolymath-plugin",
  "@tencent-connect/omnipolymath-qqbot",
  "@zalo-platforms/omnipolymath-zaloclawbot",
  "omnipolymath-plugin-yuanbao",
  "@telnyx/omnipolymath-provider",
  "@poolside/omnipolymath-provider",
]);

export type PluginInstallInput = {
  /** "plugin-npm", "plugin-archive", "plugin-dir", "plugin-file" or "plugin-git". */
  kind?: string;
  packageName?: string;
  requestedSpecifier?: string;
};

function nameFromSpecifier(spec: string | undefined): string | undefined {
  if (!spec) {
    return undefined;
  }
  const bare = spec.replace(/^(clawhub|npm):/u, "");
  const m = /^(@[^/@\s]+\/[^@\s]+|[^@\s/][^@\s]*)/u.exec(bare);
  return m?.[1];
}

/** Returns a block reason, or undefined when the install may continue. */
export function checkPluginInstall(
  input: PluginInstallInput,
  opts: { allowRegistryOfficialScope: boolean },
): string | undefined {
  const fromRegistry =
    input.kind === "plugin-npm" ||
    /^(clawhub|npm):/u.test(input.requestedSpecifier ?? "") ||
    (input.kind === "plugin-archive" && (input.requestedSpecifier ?? "").startsWith("clawhub:"));
  const names = [input.packageName, nameFromSpecifier(input.requestedSpecifier)].filter(
    (n): n is string => typeof n === "string" && n.length > 0,
  );
  for (const name of names) {
    if (UNVERIFIED_VENDOR_PACKAGES.has(name.toLowerCase())) {
      return `${name} was never published by its vendor; a package with this name is not trustworthy`;
    }
    if (
      fromRegistry &&
      !opts.allowRegistryOfficialScope &&
      name.toLowerCase().startsWith("@omnipolymath/")
    ) {
      return `${name} ships with Omnipolymath and is not published to a registry; a registry copy is not from this project (set plugins.allowRegistryOfficialScope once you publish there)`;
    }
  }
  return undefined;
}
