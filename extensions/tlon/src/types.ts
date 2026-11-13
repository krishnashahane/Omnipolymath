import {
  createAccountListHelpers,
  resolveChannelMediaMaxBytes,
} from "omnipolymath/plugin-sdk/account-helpers";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "omnipolymath/plugin-sdk/account-resolution";
import type { ResolvedChannelImplicitMentions } from "omnipolymath/plugin-sdk/channel-ingress-runtime";
import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import type { z } from "zod";
import type { TlonConfigSchema } from "./config-schema.js";

type TlonAccountConfig = z.input<typeof TlonConfigSchema> & {
  implicitMentions?: Partial<ResolvedChannelImplicitMentions>;
};

export type TlonResolvedAccount = {
  accountId: string;
  name: string | null;
  enabled: boolean;
  configured: boolean;
  mediaMaxBytes?: number;
  requireMentionInBotThreads?: boolean;
  ship: string | null;
  url: string | null;
  code: string | null;
  dangerouslyAllowPrivateNetwork: boolean | null;
  groupChannels: string[];
  dmAllowlist: string[];
  /** Ships allowed to invite us to groups (security: prevent malicious group invites) */
  groupInviteAllowlist: string[];
  autoDiscoverChannels: boolean | null;
  crossChannelCitations: boolean | null;
  showModelSignature: boolean | null;
  autoAcceptDmInvites: boolean | null;
  autoAcceptGroupInvites: boolean | null;
  defaultAuthorizedShips: string[];
  /** Ship that receives approval requests for DMs, channel mentions, and group invites */
  ownerShip: string | null;
};

function resolveTlonChannelConfig(cfg: OmnipolymathConfig): TlonAccountConfig | undefined {
  return cfg.channels?.tlon as TlonAccountConfig | undefined;
}

const {
  listAccountIds: listTlonAccountIds,
  resolveAccountConfig: resolveMergedNamedTlonAccountConfig,
} = createAccountListHelpers<TlonAccountConfig>("tlon", {
  normalizeAccountId,
  fallbackAccountIdWhenEmpty: false,
  hasImplicitDefaultAccount: (cfg) => Boolean(resolveTlonChannelConfig(cfg)?.ship),
});

export { listTlonAccountIds };

function resolveMergedTlonAccountConfig(cfg: OmnipolymathConfig, accountId: string): TlonAccountConfig {
  const channel = resolveTlonChannelConfig(cfg);
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return channel ?? {};
  }
  return resolveMergedNamedTlonAccountConfig(cfg, accountId);
}

export function resolveTlonAccount(
  cfg: OmnipolymathConfig,
  accountId?: string | null,
): TlonResolvedAccount {
  const resolvedAccountId = normalizeAccountId(accountId);
  const base = resolveTlonChannelConfig(cfg);

  const merged = resolveMergedTlonAccountConfig(cfg, resolvedAccountId);
  const ship = merged.ship ?? null;
  const url = merged.url ?? null;
  const code = merged.code ?? null;
  return {
    accountId: resolvedAccountId,
    name: merged.name ?? null,
    enabled: Boolean(base) && merged.enabled !== false,
    configured: Boolean(ship && url && code),
    ...(base
      ? {
          requireMentionInBotThreads: merged.requireMentionInBotThreads,
          mediaMaxBytes: resolveChannelMediaMaxBytes({
            cfg,
            accountId: resolvedAccountId,
            resolveChannelLimitMb: () => merged.mediaMaxMb,
          }),
        }
      : {}),
    ship,
    url,
    code,
    dangerouslyAllowPrivateNetwork: merged.network?.dangerouslyAllowPrivateNetwork ?? null,
    groupChannels: merged.groupChannels ?? [],
    dmAllowlist: merged.dmAllowlist ?? [],
    groupInviteAllowlist: merged.groupInviteAllowlist ?? [],
    autoDiscoverChannels: merged.autoDiscoverChannels ?? null,
    crossChannelCitations: merged.crossChannelCitations ?? null,
    showModelSignature: merged.showModelSignature ?? null,
    autoAcceptDmInvites: merged.autoAcceptDmInvites ?? null,
    autoAcceptGroupInvites: merged.autoAcceptGroupInvites ?? null,
    defaultAuthorizedShips: merged.defaultAuthorizedShips ?? [],
    ownerShip: merged.ownerShip ?? null,
  };
}
