import path from "node:path";
import { normalizeOptionalString } from "@omnipolymath/normalization-core/string-coerce";
import { resolveStateDir } from "../config/paths.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveAgentDir, tryResolveLegacyDataOwnerAgentId } from "./agent-scope-config.js";
import { getPreparedSharedAuthStoreOwnership } from "./auth-profiles/path-resolve.js";

export function resolveLegacyInheritedAuthAgentId(config: OmnipolymathConfig): string {
  return (
    normalizeOptionalString(config.agents?.defaults?.authInheritance?.agentId) ??
    tryResolveLegacyDataOwnerAgentId(config) ??
    "main"
  );
}

export function resolveLegacyInheritedAuthAgentDir(
  config: OmnipolymathConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveAgentDir(config, resolveLegacyInheritedAuthAgentId(config), env);
}

export function resolveLegacyInheritedAuthDir(
  config: OmnipolymathConfig,
  env: NodeJS.ProcessEnv = process.env,
  preparedLegacyAgentDir?: () => string | undefined,
): string | undefined {
  return getPreparedSharedAuthStoreOwnership(env)?.location === "legacy-main"
    ? (preparedLegacyAgentDir?.() ?? resolveLegacyInheritedAuthAgentDir(config, env))
    : undefined;
}

export function pinLegacyInheritedAuthOwnerForRosterTransition(
  sourceConfig: OmnipolymathConfig,
  targetConfig: OmnipolymathConfig,
): OmnipolymathConfig {
  const sourceOwner = resolveLegacyInheritedAuthAgentId(sourceConfig);
  if (sourceOwner === resolveLegacyInheritedAuthAgentId(targetConfig)) {
    return targetConfig;
  }
  return {
    ...targetConfig,
    agents: {
      ...targetConfig.agents,
      defaults: {
        ...targetConfig.agents?.defaults,
        authInheritance: {
          ...targetConfig.agents?.defaults?.authInheritance,
          agentId: sourceOwner,
        },
      },
    },
  };
}

export function assertSafeLegacyInheritedAuthDirTransition(
  sourceConfig: OmnipolymathConfig,
  targetConfig: OmnipolymathConfig,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const sourceOwner = resolveLegacyInheritedAuthAgentId(sourceConfig);
  const sourceDir = resolveAgentDir(sourceConfig, sourceOwner, env);
  const conventionalDir = path.join(
    resolveStateDir(env),
    "agents",
    normalizeAgentId(sourceOwner),
    "agent",
  );
  const targetDir = resolveAgentDir(targetConfig, sourceOwner, env);
  if (path.resolve(sourceDir) === path.resolve(conventionalDir) || targetDir === sourceDir) {
    return;
  }
  throw Object.assign(
    new Error(
      `Config write refused: inherited auth for agent "${sourceOwner}" is stored in custom agentDir ${JSON.stringify(sourceDir)}, but this roster change removes or changes that directory. Relocate the credentials to ${JSON.stringify(conventionalDir)} or set agents.defaults.authInheritance explicitly for the destination owner, then retry.`,
    ),
    { code: "CONFIG_WRITE_REJECTED" },
  );
}
