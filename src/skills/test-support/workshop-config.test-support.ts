import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import { resolveAgentSkillsRoot } from "../loading/skill-paths.js";

/** Adds Workshop settings at the plugin's own config path, marked as already migrated. */
export function workshopPluginConfig(
  settings: Record<string, unknown>,
  base: OmnipolymathConfig = {},
): OmnipolymathConfig {
  return {
    ...base,
    plugins: {
      ...base.plugins,
      entries: { ...base.plugins?.entries, "skill-workshop": { config: settings } },
    },
    meta: { ...base.meta, migrations: { ...base.meta?.migrations, skillWorkshopPlugin: true } },
  };
}

/** The per-agent folder the skill-workshop plugin's manifest `agentSkillsDir` names. */
export function resolveWorkshopSkillsDir(
  config: OmnipolymathConfig,
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveAgentSkillsRoot({ config, agentId, dirName: "workshop-skills", env });
}
