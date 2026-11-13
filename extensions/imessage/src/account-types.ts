import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";

export type IMessageAccountConfig = Omit<
  NonNullable<NonNullable<OmnipolymathConfig["channels"]>["imessage"]>,
  "accounts" | "defaultAccount"
>;
