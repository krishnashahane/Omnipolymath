import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";

type SignalChannelConfig = Exclude<NonNullable<OmnipolymathConfig["channels"]>["signal"], undefined>;

export type SignalAccountConfig = Omit<SignalChannelConfig, "accounts" | "defaultAccount">;

export type SignalTransportConfig = NonNullable<SignalChannelConfig["transport"]>;
