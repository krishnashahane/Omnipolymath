import fs from "node:fs";
import path from "node:path";
import { writeJsonFile } from "../../test/helpers/temp-repo.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import type { PluginInstallRecord } from "../config/types.plugins.js";

export function writeCohortPackage(
  directory: string,
  id: string,
  options: { packageName?: string; entries?: string[]; source?: string } = {},
) {
  const entries = options.entries ?? ["index"];
  writeJsonFile(path.join(directory, "package.json"), {
    name: options.packageName ?? `@example/${id}`,
    version: "1.0.0",
    omnipolymath: { extensions: entries.map((entry) => `./${entry}.js`) },
  });
  writeJsonFile(path.join(directory, "omnipolymath.plugin.json"), {
    id,
    configSchema: { type: "object" },
  });
  for (const entry of entries) {
    fs.writeFileSync(
      path.join(directory, `${entry}.js`),
      options.source ?? "module.exports = {};\n",
    );
  }
}

export function createCohortEnv(root: string, registry?: string) {
  return {
    HOME: root,
    OMNIPOLYMATH_STATE_DIR: path.join(root, "state"),
    OMNIPOLYMATH_BUNDLED_PLUGINS_DIR: path.join(root, "bundled"),
    ...(registry
      ? {
          NPM_CONFIG_REGISTRY: registry,
          npm_config_registry: registry,
          NPM_CONFIG_CACHE: path.join(root, "npm-cache"),
          NPM_CONFIG_USERCONFIG: path.join(root, "empty.npmrc"),
        }
      : {}),
  };
}

export function cohortConfig(
  installs: Record<string, PluginInstallRecord>,
  plugins: Omit<NonNullable<OmnipolymathConfig["plugins"]>, "installs"> = {},
) {
  return { plugins: { ...plugins, installs } };
}
