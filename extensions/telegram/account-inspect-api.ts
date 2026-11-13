import type { OmnipolymathConfig } from "./runtime-api.js";
import { inspectTelegramAccount } from "./src/account-inspect.js";

export function inspectTelegramReadOnlyAccount(cfg: OmnipolymathConfig, accountId?: string | null) {
  return inspectTelegramAccount({ cfg, accountId });
}
