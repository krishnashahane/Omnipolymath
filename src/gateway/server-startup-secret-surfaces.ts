import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { isChannelStartupSuppressedByEnvironment } from "./server-sidecar-startup-mode.js";

export function resolveGatewayStartupSourceConfig(
  config: OmnipolymathConfig,
  env: NodeJS.ProcessEnv,
): OmnipolymathConfig {
  const skipChannels = isChannelStartupSuppressedByEnvironment(env);
  if (!skipChannels || !config.channels) {
    return config;
  }
  return {
    ...config,
    channels: undefined,
  };
}
