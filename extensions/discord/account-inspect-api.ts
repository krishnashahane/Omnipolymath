import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import { inspectDiscordAccount } from "./src/account-inspect.js";

export function inspectDiscordReadOnlyAccount(cfg: OmnipolymathConfig, accountId?: string | null) {
  return inspectDiscordAccount({ cfg, accountId });
}
