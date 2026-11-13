import { inheritLegacyDefaultAgentId } from "../../../config/legacy.default-agent-owner.js";
import { copyConfigResolutionFactsThroughRewrite } from "../../../config/resolution-facts.js";
import type { OmnipolymathConfig } from "../../../config/types.omnipolymath.js";

export type DoctorConfigMutationState = {
  /** Config currently used for command execution. */
  cfg: OmnipolymathConfig;
  /** Best candidate config after pending doctor mutations. */
  candidate: OmnipolymathConfig;
  /** True when candidate differs from the persisted/effective config path. */
  pendingChanges: boolean;
  /** User-facing fix hints printed when preview mode leaves changes unapplied. */
  fixHints: string[];
};

export type DoctorConfigMutationResult = {
  /** Candidate config after the mutation. */
  config: OmnipolymathConfig;
  /** User-facing change lines; empty means no mutation should be applied. */
  changes: string[];
};

/** Apply a config mutation to doctor state, writing cfg only in repair mode. */
export function applyDoctorConfigMutation(params: {
  state: DoctorConfigMutationState;
  mutation: DoctorConfigMutationResult;
  shouldRepair: boolean;
  fixHint?: string;
}): DoctorConfigMutationState {
  const { state, mutation, shouldRepair, fixHint } = params;
  if (mutation.changes.length === 0) {
    return state;
  }
  const config = inheritLegacyDefaultAgentId(state.candidate, mutation.config);
  copyConfigResolutionFactsThroughRewrite(state.candidate, config);

  return {
    cfg: shouldRepair ? config : state.cfg,
    candidate: config,
    pendingChanges: true,
    fixHints: !shouldRepair && fixHint ? [...state.fixHints, fixHint] : state.fixHints,
  };
}
