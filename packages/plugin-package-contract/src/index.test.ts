import { describe, expect, it } from "vitest";
import {
  PLUGIN_CATEGORY_SLUGS,
  listMissingExternalCodePluginFieldPaths,
  normalizeExternalPluginCompatibility,
  validatePluginCategories,
  validateExternalCodePluginPackageJson,
} from "./index.js";

const gatewayVersion = "2026.3.24-beta.2";

describe("@omnipolymath/plugin-package-contract", () => {
  it("publishes the controlled plugin category taxonomy", () => {
    expect(PLUGIN_CATEGORY_SLUGS).toEqual(
      "channels models agent-runtimes memory context voice web computer-use media security integrations developer-tools infrastructure documents-files inbox-collaboration productivity scheduling finance-payments sales-marketing data-analytics agent-orchestration research other".split(
        " ",
      ),
    );
  });

  it("validates ordered package-owned plugin categories", () => {
    expect(validatePluginCategories(undefined)).toEqual({ ok: true });
    expect(validatePluginCategories(["web", "tools", "runtime"])).toEqual({
      ok: true,
      categories: ["web", "tools", "runtime"],
    });
    expect(validatePluginCategories(["web", "web"])).toEqual({
      ok: false,
      error: "must not contain duplicates",
    });
  });

  it("normalizes the Omnipolymath compatibility block for external plugins", () => {
    expect(
      normalizeExternalPluginCompatibility({
        version: "1.2.3",
        omnipolymath: {
          compat: { pluginApi: `>=${gatewayVersion}`, minGatewayVersion: gatewayVersion },
          build: { omnipolymathVersion: gatewayVersion, pluginSdkVersion: "0.9.0" },
        },
      }),
    ).toEqual({
      pluginApiRange: ">=2026.3.24-beta.2",
      builtWithOmnipolymathVersion: gatewayVersion,
      pluginSdkVersion: "0.9.0",
      minGatewayVersion: gatewayVersion,
    });
  });

  it("falls back to install.minHostVersion and package version when compatible", () => {
    expect(
      normalizeExternalPluginCompatibility({
        version: "1.2.3",
        omnipolymath: {
          compat: { pluginApi: ">=1.0.0" },
          install: { minHostVersion: gatewayVersion },
        },
      }),
    ).toEqual({
      pluginApiRange: ">=1.0.0",
      builtWithOmnipolymathVersion: "1.2.3",
      minGatewayVersion: gatewayVersion,
    });
  });

  it("reports missing required fields with stable field paths", () => {
    const packageJson = { omnipolymath: { compat: {}, build: {} } };

    expect(listMissingExternalCodePluginFieldPaths(packageJson)).toEqual([
      "omnipolymath.compat.pluginApi",
      "omnipolymath.build.omnipolymathVersion",
    ]);
    expect(validateExternalCodePluginPackageJson(packageJson).issues).toEqual([
      {
        fieldPath: "omnipolymath.compat.pluginApi",
        message: "omnipolymath.compat.pluginApi is required for external code plugin packages.",
      },
      {
        fieldPath: "omnipolymath.build.omnipolymathVersion",
        message: "omnipolymath.build.omnipolymathVersion is required for external code plugin packages.",
      },
    ]);
  });
});
