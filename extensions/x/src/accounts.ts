import { createAccountListHelpers, mergeAccountConfig } from "omnipolymath/plugin-sdk/account-helpers";
import { normalizeAccountId } from "omnipolymath/plugin-sdk/account-id";
import { resolveAccountKey } from "omnipolymath/plugin-sdk/account-resolution";
import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import { hasConfiguredSecretInput } from "omnipolymath/plugin-sdk/secret-input";
import type { XAccountConfig } from "./config-schema.js";
import { resolveXCostLimits } from "./cost-limits.js";

const accounts = createAccountListHelpers<XAccountConfig>("x", {
  omitKeys: ["defaultAccount"],
  nestedObjectKeys: ["guests", "costLimits", "verifiedFromGitHub"],
  implicitDefaultAccount: { channelKeys: ["userId", "clientId", "refreshToken"] },
});
export const listXAccountIds = accounts.listAccountIds;
export const listXRuntimeAccountIds = (cfg: OmnipolymathConfig) => [
  ...new Set(listXAccountIds(cfg).map(normalizeAccountId)),
];
export const resolveDefaultXAccountId = accounts.resolveDefaultAccountId;
/** Config keys keep their authored case; this finds the key `resolveXAccount` reads. */
export function resolveXAccountKey(cfg: OmnipolymathConfig, accountId: string) {
  const id = normalizeAccountId(accountId);
  return resolveAccountKey(cfg.channels?.x?.accounts, id, undefined, undefined, { channelId: "x" });
}
export function resolveXAccount(cfg: OmnipolymathConfig, requested?: string | null) {
  const accountId = normalizeAccountId(requested ?? resolveDefaultXAccountId(cfg));
  const config = accounts.resolveAccountConfig(cfg, accountId);
  if (config.guests) {
    config.guests = mergeAccountConfig({
      channelConfig: cfg.channels?.x?.guests,
      accountConfig: config.guests,
      nestedObjectKeys: ["tools"],
    });
  }
  const enabled = cfg.channels?.x?.enabled !== false && config.enabled !== false;
  const configured = Boolean(
    config.userId &&
    config.username &&
    config.clientId &&
    hasConfiguredSecretInput(config.clientSecret) &&
    hasConfiguredSecretInput(config.refreshToken),
  );
  return {
    accountId,
    config,
    costLimits: resolveXCostLimits(config.costLimits),
    enabled,
    configured,
    userId: config.userId ?? "",
    username: config.username ?? "",
    name: config.name,
  };
}
export type ResolvedXAccount = ReturnType<typeof resolveXAccount>;
