import { tryProcessCwd } from "../infra/safe-cwd.js";
import { shouldTrustTestBundledPluginsDirOverride } from "./bundled-dir.js";
import {
  hasActivePluginInstallRoots,
  resolveActivePluginInstallRoots,
} from "./install-root-context.js";
import { hashJson } from "./installed-plugin-index-hash.js";

const PLUGIN_METADATA_ENV_KEYS = [
  "ANDROID_DATA",
  "APPDATA",
  "HOME",
  "OMNIPOLYMATH_BUNDLED_PLUGINS_DIR",
  "OMNIPOLYMATH_COMPATIBILITY_HOST_VERSION",
  "OMNIPOLYMATH_CONFIG_PATH",
  "OMNIPOLYMATH_DEV_SOURCE_ROOT",
  "OMNIPOLYMATH_DISABLE_BUNDLED_PLUGINS",
  "OMNIPOLYMATH_DISABLE_BUNDLED_SOURCE_OVERLAYS",
  "OMNIPOLYMATH_HOME",
  "OMNIPOLYMATH_NIX_MODE",
  "OMNIPOLYMATH_STATE_DIR",
  "PREFIX",
  "USERPROFILE",
  "XDG_CONFIG_HOME",
] as const;

/** Compares discovery namespaces without resolving or probing filesystem roots. */
export function resolvePluginMetadataEnvFingerprint(env: NodeJS.ProcessEnv = process.env): string {
  return hashJson({
    env: Object.fromEntries(
      PLUGIN_METADATA_ENV_KEYS.flatMap((key) => {
        const value = env[key];
        return value === undefined ? [] : [[key, value]];
      }),
    ),
    installRoots: hasActivePluginInstallRoots() ? resolveActivePluginInstallRoots() : undefined,
    trustBundledPluginsDirOverride: shouldTrustTestBundledPluginsDirOverride(env),
    cwd: tryProcessCwd(),
  });
}
