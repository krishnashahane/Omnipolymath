import type { ExecPolicyOverrides } from "../../agents/exec-defaults.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import type { SkillCommandSpec } from "../../skills/types.js";
import type { HandleCommandsParams } from "./commands-types.js";

type SkillCommandsRuntime = typeof import("../../skills/discovery/chat-commands.runtime.js");

export function createSkillCommandLoaders(
  loadRuntime: () => Promise<SkillCommandsRuntime>,
  params: {
    workspaceDir: string;
    cfg: OmnipolymathConfig;
    agentId?: string;
    skillFilter?: string[];
    sessionEntry?: SessionEntry;
    sessionKey?: string;
    execOverrides?: ExecPolicyOverrides;
    loadSkillCommands?: () => Promise<SkillCommandSpec[]>;
  },
): Pick<HandleCommandsParams, "loadSkillCommands" | "loadBundledSkillCommand"> {
  const { loadSkillCommands, ...context } = params;
  return {
    loadSkillCommands:
      loadSkillCommands ??
      (async () => (await loadRuntime()).prepareSkillCommandsForWorkspace(context)),
    loadBundledSkillCommand: async (skillName) =>
      (await loadRuntime()).prepareBundledSkillCommandForWorkspace({
        ...context,
        skillName,
      }),
  };
}
