import fs from "node:fs/promises";
import path from "node:path";
import { writeFixtureJson } from "../../../cli/cli-fixtures.test-support.js";
import type { OmnipolymathConfig } from "../../../config/types.omnipolymath.js";
import type { PluginInstallRecord } from "../../../config/types.plugins.js";
import { seedInstalledPluginIndex } from "../../../plugins/test-helpers/installed-plugin-index.js";
import type { OmnipolymathTestState } from "../../../test-utils/omnipolymath-test-state.js";

/** An already published official replacement, without invoking any installer. */
export async function seedRecoveryOwner(
  state: OmnipolymathTestState,
  config: OmnipolymathConfig,
  options: { version?: string; minHostVersion?: string; root?: string } = {},
) {
  const root = options.root ?? state.statePath("extensions", "omnipolymath-qqbot");
  const version = options.version ?? "2.0.3";
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "index.js"), "module.exports = {};\n");
  await writeFixtureJson(path.join(root, "omnipolymath.plugin.json"), {
    id: "omnipolymath-qqbot",
    legacyPluginIds: ["qqbot"],
    configSchema: { type: "object" },
  });
  await writeFixtureJson(path.join(root, "package.json"), {
    name: "@tencent-connect/omnipolymath-qqbot",
    version,
    omnipolymath: {
      extensions: ["./index.js"],
      ...(options.minHostVersion ? { install: { minHostVersion: options.minHostVersion } } : {}),
    },
  });
  const records: Record<string, PluginInstallRecord> = {
    "omnipolymath-qqbot": {
      source: "npm",
      spec: `@tencent-connect/omnipolymath-qqbot@${version}`,
      resolvedName: "@tencent-connect/omnipolymath-qqbot",
      resolvedSpec: `@tencent-connect/omnipolymath-qqbot@${version}`,
      version,
      installPath: root,
    },
  };
  await seedInstalledPluginIndex(records, { config, env: state.env });
  return { root, records };
}
