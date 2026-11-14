import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";
import { checkPluginInstall } from "./plugin-install.js";

const strict = { allowRegistryOfficialScope: false };

describe("plugin install supply-chain checks", () => {
  it("blocks renamed vendor packages that were never published", () => {
    for (const name of [
      "@tencent-weixin/omnipolymath-weixin",
      "@wecom/wecom-omnipolymath-plugin",
      "omnipolymath-plugin-yuanbao",
      "@telnyx/omnipolymath-provider",
    ]) {
      expect(checkPluginInstall({ kind: "plugin-npm", packageName: name }, strict), name).toMatch(
        /never published/,
      );
    }
    expect(
      checkPluginInstall(
        {
          kind: "plugin-archive",
          requestedSpecifier: "clawhub:@telnyx/omnipolymath-provider@0.2.0",
        },
        strict,
      ),
    ).toMatch(/never published/);
  });
  it("blocks @omnipolymath packages from a registry until allowed", () => {
    expect(
      checkPluginInstall({ kind: "plugin-npm", packageName: "@omnipolymath/discord" }, strict),
    ).toMatch(/not published to a registry/);
    expect(
      checkPluginInstall(
        { kind: "plugin-npm", requestedSpecifier: "npm:@omnipolymath/slack@1.0.0" },
        strict,
      ),
    ).toMatch(/not published to a registry/);
    expect(
      checkPluginInstall(
        { kind: "plugin-npm", packageName: "@omnipolymath/discord" },
        { allowRegistryOfficialScope: true },
      ),
    ).toBeUndefined();
  });
  it("allows local and third-party installs", () => {
    expect(
      checkPluginInstall({ kind: "plugin-dir", packageName: "@omnipolymath/discord" }, strict),
    ).toBeUndefined();
    expect(
      checkPluginInstall({ kind: "plugin-npm", packageName: "@acme/omnipolymath-tools" }, strict),
    ).toBeUndefined();
    expect(
      checkPluginInstall({ kind: "plugin-npm", packageName: "left-pad" }, strict),
    ).toBeUndefined();
  });
  it("defaults to the strict setting", () => {
    expect(parseConfig(undefined).plugins.allowRegistryOfficialScope).toBe(false);
    expect(
      parseConfig({ plugins: { allowRegistryOfficialScope: true } }).plugins
        .allowRegistryOfficialScope,
    ).toBe(true);
  });
});
