import { withAgentModelAliases, type OmnipolymathConfig } from "omnipolymath/plugin-sdk/provider-onboard";

export const OPENCODE_ZEN_DEFAULT_MODEL_REF = "opencode/claude-opus-5";

export function applyOpencodeZenProviderConfig(cfg: OmnipolymathConfig): OmnipolymathConfig {
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        models: withAgentModelAliases(cfg.agents?.defaults?.models, [
          { modelRef: OPENCODE_ZEN_DEFAULT_MODEL_REF, alias: "Opus" },
        ]),
      },
    },
  };
}
