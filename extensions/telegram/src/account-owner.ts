import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import { resolveAgentRoute } from "omnipolymath/plugin-sdk/routing";

export function resolveTelegramAccountOwnerAgentId(params: {
  cfg: OmnipolymathConfig;
  accountId?: string | null;
}): string {
  const { cfg, accountId } = params;
  return resolveAgentRoute({ cfg, channel: "telegram", accountId }).agentId;
}
