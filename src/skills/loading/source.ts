import { normalizeOptionalString } from "@omnipolymath/normalization-core/string-coerce";
import type { SkillTelemetrySource } from "../types.js";
import type { Skill } from "./skill-contract.js";

/** Returns the stable source label attached to a loaded skill. */
export function resolveSkillSource(skill: Partial<Pick<Skill, "source" | "sourceInfo">>): string {
  return (
    normalizeOptionalString(skill.source) ??
    normalizeOptionalString(skill.sourceInfo?.source) ??
    "unknown"
  );
}

export function resolveSkillTelemetrySourceValue(value: unknown): SkillTelemetrySource {
  const source = normalizeOptionalString(value) ?? "";
  if (source === "bundled" || source === "omnipolymath-bundled" || source === "omnipolymath-custodian") {
    return "bundled";
  }
  if (
    source === "workspace" ||
    source === "omnipolymath-workspace" ||
    source === "omnipolymath-workshop" ||
    source === "omnipolymath-managed" ||
    source === "omnipolymath-extra" ||
    source === "agents-skills-personal" ||
    source === "agents-skills-project"
  ) {
    return "workspace";
  }
  return "unknown";
}

export function resolveSkillTelemetrySource(
  skill: Partial<Pick<Skill, "source" | "sourceInfo">>,
): SkillTelemetrySource {
  return resolveSkillTelemetrySourceValue(resolveSkillSource(skill));
}
