import {
  createAliasOnlyPresetAppliers,
  type OmnipolymathConfig,
} from "omnipolymath/plugin-sdk/provider-onboard";
import { DEEPINFRA_DEFAULT_MODEL_REF } from "./provider-static-catalog.js";

export function applyDeepInfraConfig(
  cfg: OmnipolymathConfig,
  modelRef: string = DEEPINFRA_DEFAULT_MODEL_REF,
): OmnipolymathConfig {
  return createAliasOnlyPresetAppliers({ modelRef, alias: "DeepInfra" }).applyConfig(cfg);
}
