// Register suite mocks before imports that read the install catalog.
import "./missing-configured-plugin-install.suite.test-support.js";
import path from "node:path";
import { expectDefined } from "@omnipolymath/normalization-core";
import { describe, expect, it } from "vitest";
import type { OmnipolymathConfig } from "../../../config/types.js";
import { channelPluginEntry } from "./missing-configured-plugin-install.test-helpers.js";

const { mocks, testEnv, tempDirs, setupPluginInstallSuite } =
  await import("./missing-configured-plugin-install.suite.test-support.js");
const {
  configuredPluginInstallIssueToHealthFinding,
  configuredPluginInstallIssueToRepairEffect,
  detectConfiguredPluginInstallHealthIssues,
} = await import("./missing-configured-plugin-install.js");

async function detect(cfg: OmnipolymathConfig, env = testEnv) {
  const issues = await detectConfiguredPluginInstallHealthIssues({ cfg, env });
  for (const mock of [
    mocks.installPluginFromClawHub,
    mocks.installPluginFromNpmSpec,
    mocks.resolveNpmSpecMetadata,
    mocks.writePersistedInstalledPluginIndexInstallRecordsWithLease,
  ]) {
    expect(mock).not.toHaveBeenCalled();
  }
  return issues;
}

describe("configured plugin install health findings", () => {
  setupPluginInstallSuite();

  it.each([false, true])(
    "reports install health without mutation (deferred=%s)",
    async (deferred) => {
      const pluginId = deferred ? "discord" : "matrix";
      const npmSpec = deferred ? "@omnipolymath/discord" : "@omnipolymath/plugin-matrix";
      const installPath = path.resolve("/missing/discord");
      if (deferred) {
        mocks.loadInstalledPluginIndexInstallRecords.mockResolvedValue({
          discord: { source: "npm", spec: npmSpec, installPath },
        });
      }
      mocks.listChannelPluginCatalogEntries.mockReturnValue([
        deferred
          ? channelPluginEntry({ id: pluginId, label: "Discord", npmSpec })
          : {
              id: pluginId,
              pluginId,
              meta: { label: "Matrix" },
              install: { npmSpec, expectedIntegrity: "sha512-test" },
              trustedSourceLinkedOfficialInstall: true,
            },
      ]);
      const cfg: OmnipolymathConfig = deferred
        ? {
            plugins: { entries: { [pluginId]: { enabled: true } } },
            channels: { discord: { enabled: true } },
          }
        : {
            update: { channel: "beta" },
            channels: { matrix: { enabled: true, homeserver: "https://matrix.example.org" } },
          };
      const env = deferred
        ? {
            ...testEnv,
            OMNIPOLYMATH_UPDATE_IN_PROGRESS: "1",
            OMNIPOLYMATH_UPDATE_DEFER_CONFIGURED_PLUGIN_INSTALL_REPAIR: "1",
          }
        : testEnv;

      const issue = expectDefined((await detect(cfg, env))[0], "health issue");
      expect(issue).toEqual(
        deferred
          ? { kind: "deferred-package-manager-repair", pluginId, installPath }
          : { kind: "missing-install-record", pluginId, installSpec: npmSpec },
      );
      expect(configuredPluginInstallIssueToHealthFinding(issue)).toMatchObject({
        checkId: "core/doctor/configured-plugin-installs",
        severity: "warning",
        target: pluginId,
        ...(deferred
          ? { path: installPath }
          : { fixHint: "Run `omnipolymath doctor --fix` to install @omnipolymath/plugin-matrix." }),
      });
      expect(configuredPluginInstallIssueToRepairEffect(issue)).toEqual({
        kind: "package",
        action: deferred
          ? "would-defer-configured-plugin-install-repair"
          : "would-install-configured-plugin",
        target: pluginId,
        dryRunSafe: deferred,
      });
    },
  );

  const clawhub = "clawhub:demo@1.2.3",
    npm = "@example/demo@1.2.3";
  it.each([
    ["clawhub", "clawhub:demo@latest", clawhub, clawhub, clawhub],
    ["npm", npm, undefined, npm, `npm:${npm}`],
    ["clawhub", undefined, undefined, undefined, undefined],
  ] as const)(
    "preserves empty-project identity: %s %s",
    async (source, spec, resolvedSpec, installSpec, command) => {
      const installPath = tempDirs.make("omnipolymath-doctor-empty-plugin-");
      mocks.loadInstalledPluginIndexInstallRecords.mockResolvedValue({
        demo: {
          source,
          spec,
          resolvedSpec,
          installPath,
        },
      });
      mocks.listChannelPluginCatalogEntries.mockReturnValue([
        channelPluginEntry({ id: "demo", label: "Demo", npmSpec: "@example/catalog-demo" }),
      ]);

      const issues = await detect({
        plugins: { entries: { demo: { enabled: true } } },
        channels: { demo: { enabled: true } },
      });

      const issue = expectDefined(issues[0], "missing payload issue");
      expect(configuredPluginInstallIssueToHealthFinding(issue)).toMatchObject({
        target: "demo",
        source,
        fixHint: command
          ? `Run \`omnipolymath plugins install ${command} --force\` to reinstall the configured plugin package.`
          : "Run `omnipolymath doctor --fix` to repair the configured plugin install. An exact reinstall command is unavailable because the install record has no package spec.",
      });
      expect(issues).toEqual([
        {
          kind: "missing-installed-payload",
          pluginId: "demo",
          installPath,
          installSpec,
          installSource: source,
        },
      ]);
    },
  );
});
