import type { ChannelPlugin } from "omnipolymath/plugin-sdk/core";
import type { ResolvedWhatsAppAccount } from "./accounts.js";
import { createWhatsAppPluginBase } from "./shared.js";

export const whatsappSetupPlugin: ChannelPlugin<ResolvedWhatsAppAccount> =
  createWhatsAppPluginBase();
