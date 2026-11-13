import {
  normalizeTrimmedStringList,
  uniqueStrings,
} from "@omnipolymath/normalization-core/string-normalization";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import { resolvePathViaExistingAncestorSync, safeRealpathSync } from "../../infra/boundary-path.js";
import { resolveUserPath } from "../../utils.js";

export function resolveAllowedSkillSymlinkTargetRealPaths(config?: OmnipolymathConfig): string[] {
  const targetPaths = normalizeTrimmedStringList(config?.skills?.load?.allowSymlinkTargets)
    .map((dir) => tryRealpath(resolveUserPath(dir)))
    .filter((dir): dir is string => Boolean(dir));
  return uniqueStrings(targetPaths);
}

export function tryRealpath(filePath: string): string | null {
  try {
    // Use fs-safe's native platform handling, then require an existing path.
    return safeRealpathSync(resolvePathViaExistingAncestorSync(filePath));
  } catch {
    return null;
  }
}
