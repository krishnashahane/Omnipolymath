import { compareSemverStrings } from "./npm-registry-spec.js";

const EXTERNAL_SERVICE_REPAIR_POLICY_MIN_VERSION = "2026.4.25-beta.1";

export function resolveUpdateDoctorExecutionPolicy(params: { targetVersion: string | null }): {
  fix: boolean;
  serviceRepairPolicy?: "external";
} {
  const support = compareSemverStrings(
    params.targetVersion,
    EXTERNAL_SERVICE_REPAIR_POLICY_MIN_VERSION,
  );
  if (support !== null && support >= 0) {
    return { fix: true, serviceRepairPolicy: "external" };
  }
  // Older targets ignore ownership markers and the external-service policy.
  return { fix: false };
}

export function buildUpdateDoctorEnv(params: {
  allowGatewayServiceRepair: boolean;
  allowGatewayActivation: boolean;
  serviceRepairPolicy?: "external";
  deferConfiguredPluginInstallRepair?: boolean;
  compatibilityHostVersion?: string | null;
}): NodeJS.ProcessEnv {
  return {
    OMNIPOLYMATH_UPDATE_IN_PROGRESS: "1",
    ...(params.deferConfiguredPluginInstallRepair
      ? { OMNIPOLYMATH_UPDATE_DEFER_CONFIGURED_PLUGIN_INSTALL_REPAIR: "1" }
      : {}),
    OMNIPOLYMATH_UPDATE_PARENT_SUPPORTS_DOCTOR_CONFIG_WRITE: "1",
    OMNIPOLYMATH_UPDATE_PARENT_SUPPORTS_GATEWAY_RESTART: "1",
    OMNIPOLYMATH_UPDATE_PARENT_ALLOWS_GATEWAY_SERVICE_REPAIR: params.allowGatewayServiceRepair
      ? "1"
      : "0",
    OMNIPOLYMATH_UPDATE_PARENT_ALLOWS_GATEWAY_ACTIVATION: params.allowGatewayActivation ? "1" : "0",
    // An absent phase policy must clear the inherited value at the spawn boundary.
    OMNIPOLYMATH_SERVICE_REPAIR_POLICY: params.serviceRepairPolicy,
    ...(params.compatibilityHostVersion
      ? { OMNIPOLYMATH_COMPATIBILITY_HOST_VERSION: params.compatibilityHostVersion }
      : {}),
  };
}
