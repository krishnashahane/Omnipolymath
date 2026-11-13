import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";

export type TelegramChannelConfig = NonNullable<
  NonNullable<OmnipolymathConfig["channels"]>["telegram"]
>;

export function makeTelegramConfig(
  telegram: TelegramChannelConfig,
  config: Omit<OmnipolymathConfig, "channels"> = {},
): OmnipolymathConfig {
  return {
    ...config,
    messages: {
      ...config.messages,
      inbound: { debounceMs: 0, ...config.messages?.inbound },
    },
    channels: { telegram },
  };
}

export function makeDirectTelegramConfig(
  storePath: string,
  telegramOverrides: TelegramChannelConfig = {},
): OmnipolymathConfig {
  return makeTelegramConfig(
    { dmPolicy: "open", allowFrom: ["*"], ...telegramOverrides },
    { session: { store: storePath } },
  );
}
