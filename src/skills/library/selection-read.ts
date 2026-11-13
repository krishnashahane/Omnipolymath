import type { SkillLibrarySelection } from "../../../packages/gateway-protocol/src/schema/skill-library.js";
import { executeExistingOmnipolymathStateRead } from "../../state/omnipolymath-state-db-readonly.js";
import type { OmnipolymathStateDatabaseOptions } from "../../state/omnipolymath-state-db.js";

export async function readSkillLibrarySelectionDescriptions(
  selections: readonly Pick<SkillLibrarySelection, "skillId" | "revision">[],
  options: Pick<OmnipolymathStateDatabaseOptions, "path" | "env">,
) {
  const result = await executeExistingOmnipolymathStateRead(options, {
    type: "skills.library.descriptions",
    input: selections.map(({ skillId, revision }) => ({ skillId, revision })),
  });
  return result?.value;
}

export async function readSkillLibrarySelectionManifests(
  selections: readonly Pick<SkillLibrarySelection, "skillId" | "revision">[],
  options: Pick<OmnipolymathStateDatabaseOptions, "path" | "env">,
) {
  if (!selections.length) {
    return [];
  }
  const result = await executeExistingOmnipolymathStateRead(options, {
    type: "skills.library.manifests",
    input: selections.map(({ skillId, revision }) => ({ skillId, revision })),
  });
  return result?.value;
}
