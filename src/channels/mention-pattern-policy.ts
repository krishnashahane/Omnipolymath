import { isRecord } from "@omnipolymath/normalization-core/record-coerce";
import { normalizeOptionalString } from "@omnipolymath/normalization-core/string-coerce";
import type { MentionPatternsMode, MentionPatternsPolicyConfig } from "../config/types.messages.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";

export type ResolveMentionPatternPolicyParams = {
  cfg?: OmnipolymathConfig;
  provider?: string;
  conversationId?: string | null;
  providerPolicy?: MentionPatternsPolicyConfig;
  agentId?: string;
};

export type ResolvedMentionPatternPolicy = {
  effectiveMode: MentionPatternsMode;
  allowMatched: boolean;
  denyMatched: boolean;
  enabled: boolean;
};

function resolveProviderMentionPatternsPolicy(
  cfg: OmnipolymathConfig | undefined,
  provider: string | undefined,
): MentionPatternsPolicyConfig | undefined {
  if (!cfg || !provider) {
    return undefined;
  }
  const channelConfig = cfg.channels?.[provider];
  const policy = isRecord(channelConfig) ? channelConfig.mentionPatterns : undefined;
  return isRecord(policy) ? policy : undefined;
}

export function resolveMentionPatternPolicy(
  params: ResolveMentionPatternPolicyParams,
): ResolvedMentionPatternPolicy {
  const conversationId = normalizeOptionalString(params.conversationId);
  const providerPolicy =
    params.providerPolicy ?? resolveProviderMentionPatternsPolicy(params.cfg, params.provider);
  const effectiveMode =
    providerPolicy?.mode === "allow" || providerPolicy?.mode === "deny"
      ? providerPolicy.mode
      : "allow";
  const allowMatched =
    conversationId != null &&
    (providerPolicy?.allowIn ?? []).some(
      (value) => normalizeOptionalString(value) === conversationId,
    );
  const denyMatched =
    conversationId != null &&
    (providerPolicy?.denyIn ?? []).some(
      (value) => normalizeOptionalString(value) === conversationId,
    );
  // Deny always wins. In allow mode everything is enabled except explicit denies; in deny mode
  // only explicitly allowed conversations are enabled.
  const enabled = effectiveMode === "allow" ? !denyMatched : allowMatched && !denyMatched;

  return { effectiveMode, allowMatched, denyMatched, enabled };
}
