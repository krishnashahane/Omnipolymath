import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import {
  resolveThreadBindingIdleTimeoutMsForChannel,
  resolveThreadBindingMaxAgeMsForChannel,
  resolveThreadBindingsEnabled,
} from "omnipolymath/plugin-sdk/conversation-runtime";

export { resolveThreadBindingsEnabled };

export function resolveDiscordThreadBindingIdleTimeoutMs(params: {
  cfg: OmnipolymathConfig;
  accountId?: string;
}): number {
  return resolveThreadBindingIdleTimeoutMsForChannel({ ...params, channel: "discord" });
}

export function resolveDiscordThreadBindingMaxAgeMs(params: {
  cfg: OmnipolymathConfig;
  accountId?: string;
}): number {
  return resolveThreadBindingMaxAgeMsForChannel({ ...params, channel: "discord" });
}
