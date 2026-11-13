import {
  resolveStickyModelSelectionPolicy,
  type StickyModelSelectionPolicy,
} from "../../agents/sticky-model-selection.js";
import { resolveIsConfigReadOnly } from "../../config/paths.js";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import { ADMIN_SCOPE } from "../operator-scopes.js";

export function resolveGatewayModelSelectionPolicy(params: {
  callerScopes: readonly string[];
  cfg: OmnipolymathConfig;
}): StickyModelSelectionPolicy {
  return resolveStickyModelSelectionPolicy({
    canPersistConfig:
      params.callerScopes.includes(ADMIN_SCOPE) && !resolveIsConfigReadOnly(process.env),
    cfg: params.cfg,
  });
}
