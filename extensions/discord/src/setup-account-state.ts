import { normalizeAccountId } from "omnipolymath/plugin-sdk/account-id";
import type { DiscordAccountConfig, OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import {
  resolveDefaultDiscordAccountId,
  mergeDiscordAccountConfig,
  inspectDiscordAccountConfig,
} from "./accounts.js";
import { resolveDiscordToken } from "./token.js";

export function resolveDiscordSetupAccountConfig(params: {
  cfg: OmnipolymathConfig;
  accountId?: string | null;
}): { accountId: string; config: DiscordAccountConfig } {
  const accountId = normalizeAccountId(
    params.accountId ?? resolveDefaultDiscordAccountId(params.cfg),
  );
  return {
    accountId,
    config: mergeDiscordAccountConfig(params.cfg, accountId),
  };
}

export function inspectDiscordSetupAccount(params: {
  cfg: OmnipolymathConfig;
  accountId?: string | null;
}) {
  return inspectDiscordAccountConfig(params, {
    // Known divergence: setup keeps the runtime-aware resolver for its final branch.
    resolveFallbackToken: (accountId) => resolveDiscordToken(params.cfg, { accountId }),
  });
}
