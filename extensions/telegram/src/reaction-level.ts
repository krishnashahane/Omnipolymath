import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import {
  resolveReactionLevel,
  type ReactionLevel,
  type ResolvedReactionLevel as BaseResolvedReactionLevel,
} from "omnipolymath/plugin-sdk/status-helpers";
import { inspectTelegramAccount } from "./account-inspect.js";

export type TelegramReactionLevel = ReactionLevel;
export type ResolvedReactionLevel = BaseResolvedReactionLevel;

export function resolveTelegramReactionLevel(params: {
  cfg: OmnipolymathConfig;
  accountId?: string;
}): ResolvedReactionLevel {
  return resolveReactionLevel({
    value: inspectTelegramAccount(params).config.reactionLevel,
    defaultLevel: "minimal",
    invalidFallback: "ack",
  });
}
