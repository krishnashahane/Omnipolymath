import {
  applyAgentDefaultMediaModel,
  type OmnipolymathConfig,
} from "omnipolymath/plugin-sdk/provider-onboard";

const FAL_DEFAULT_IMAGE_MODEL_REF = "fal/fal-ai/flux/dev";

export function applyFalConfig(cfg: OmnipolymathConfig): OmnipolymathConfig {
  return applyAgentDefaultMediaModel(cfg, "image", FAL_DEFAULT_IMAGE_MODEL_REF);
}
