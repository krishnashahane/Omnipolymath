import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import { inspectSlackAccount } from "./src/account-inspect.js";

export function inspectSlackReadOnlyAccount(cfg: OmnipolymathConfig, accountId?: string | null) {
  return inspectSlackAccount({ cfg, accountId });
}
