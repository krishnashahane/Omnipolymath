import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import {
  resolveReactionLevel,
  type ReactionLevel,
  type ResolvedReactionLevel,
} from "omnipolymath/plugin-sdk/status-helpers";
import { resolveSignalAccount } from "./accounts.js";

export type SignalReactionLevel = ReactionLevel;
export type ResolvedSignalReactionLevel = ResolvedReactionLevel;

export function resolveSignalReactionLevel(params: {
  cfg: OmnipolymathConfig;
  accountId?: string;
}): ResolvedSignalReactionLevel {
  const account = resolveSignalAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  return resolveReactionLevel({
    value: account.config.reactionLevel,
    defaultLevel: "minimal",
    invalidFallback: "minimal",
  });
}
