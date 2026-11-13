import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { resolveSetupSecretInputString } from "./setup.secret-input.js";
import type { GatewayWizardSettings } from "./setup.types.js";

// Trusted-proxy gateways use a local password for direct-loopback clients;
// a shared token cannot authenticate those clients in proxy mode.
export function gatewayAuthUsesLocalPassword(authMode: GatewayWizardSettings["authMode"]): boolean {
  return authMode === "password" || authMode === "trusted-proxy";
}

// Configured refs stay authoritative: resolution errors must not fall back
// to an ambient password.
export async function resolveGatewayLocalPassword(params: {
  nextConfig: OmnipolymathConfig;
  env: NodeJS.ProcessEnv;
}): Promise<string> {
  return (
    (await resolveSetupSecretInputString({
      config: params.nextConfig,
      value: params.nextConfig.gateway?.auth?.password,
      path: "gateway.auth.password",
      env: params.env,
    })) ??
    params.env.OMNIPOLYMATH_GATEWAY_PASSWORD?.trim() ??
    ""
  );
}
