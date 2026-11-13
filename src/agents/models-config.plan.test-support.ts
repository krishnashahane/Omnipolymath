import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { planOmnipolymathModelsJson, type PreparedModelsConfigContext } from "./models-config.plan.js";

type PreparedPlanParams = Parameters<typeof planOmnipolymathModelsJson>[0];
type FlatPreparedContext = Omit<
  PreparedModelsConfigContext,
  "discoveryAuthConfig" | "sourceConfigForSecrets" | "envFingerprint"
> & {
  discoveryAuthConfig?: OmnipolymathConfig;
  sourceConfigForSecrets?: OmnipolymathConfig;
};
type PlanParams = Omit<PreparedPlanParams, "context" | "existingRaw" | "existingParsed"> &
  FlatPreparedContext & {
    existingRaw?: string;
    existingParsed?: unknown;
  };

export function planModelsJsonForTest(params: PlanParams) {
  const {
    authStore,
    existingRaw = "",
    existingParsed = null,
    pluginCatalogs,
    ...contextParams
  } = params;
  return planOmnipolymathModelsJson({
    context: {
      ...contextParams,
      discoveryAuthConfig: params.discoveryAuthConfig ?? params.cfg,
      sourceConfigForSecrets: params.sourceConfigForSecrets ?? params.cfg,
      envFingerprint: params.env,
    },
    ...(authStore ? { authStore } : {}),
    existingRaw,
    existingParsed,
    ...(pluginCatalogs ? { pluginCatalogs } : {}),
  });
}
