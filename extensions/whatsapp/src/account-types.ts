import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";

export type WhatsAppAccountConfig = NonNullable<
  NonNullable<NonNullable<OmnipolymathConfig["channels"]>["whatsapp"]>["accounts"]
>[string];
