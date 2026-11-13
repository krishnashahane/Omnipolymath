import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import { resolveEffectiveAgentSkillFilter } from "../discovery/agent-filter.js";
import { normalizeSkillFilter } from "../discovery/filter.js";
import { assertUnambiguousManagedSkillNames } from "../library/command-name.js";
import type { SkillEligibilityContext, SkillEntry } from "../types.js";
import { isSkillEntrySelected, resolveBundledAllowlist, shouldIncludeSkill } from "./config.js";

export function filterSkillEntries(
  entries: SkillEntry[],
  opts?: {
    config?: OmnipolymathConfig;
    skillFilter?: string[];
    skillOverrides?: Readonly<Record<string, boolean>>;
    eligibility?: SkillEligibilityContext;
    hasBin?: (bin: string) => boolean;
    platform?: string;
  },
): SkillEntry[] {
  const { config, skillFilter, skillOverrides, eligibility, hasBin, platform } = opts ?? {};
  const bundledAllowlist = resolveBundledAllowlist(config);
  assertUnambiguousManagedSkillNames(entries);
  const normalized = normalizeSkillFilter(skillFilter);
  return entries.filter(
    (entry) =>
      isSkillEntrySelected(entry, normalized, skillOverrides) &&
      shouldIncludeSkill({ entry, config, bundledAllowlist, eligibility, hasBin, platform }),
  );
}

export function resolveEffectiveWorkspaceSkillFilter(opts?: {
  config?: OmnipolymathConfig;
  agentId?: string;
  agentSkillFilter?: "apply" | "ignore";
  skillFilter?: string[];
}): string[] | undefined {
  if (opts?.skillFilter !== undefined) {
    return normalizeSkillFilter(opts.skillFilter);
  }
  if (opts?.agentSkillFilter === "ignore" || !opts?.config || !opts.agentId) {
    return undefined;
  }
  return resolveEffectiveAgentSkillFilter(opts.config, opts.agentId);
}
