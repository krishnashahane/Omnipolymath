import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import { normalizeGroupActivation } from "omnipolymath/plugin-sdk/group-activation";
import { getSessionEntryAsync, resolveStorePath } from "omnipolymath/plugin-sdk/session-store-runtime";
import { resolveWhatsAppInboundPolicy } from "../../inbound-policy.js";

export async function resolveGroupActivationFor(params: {
  cfg: OmnipolymathConfig;
  accountId?: string | null;
  agentId: string;
  sessionKey: string;
  conversationId: string;
}) {
  const storePath = resolveStorePath(params.cfg.session?.store, {
    agentId: params.agentId,
  });
  const entry = await getSessionEntryAsync({
    storePath,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
  });
  const requireMention = resolveWhatsAppInboundPolicy({
    cfg: params.cfg,
    accountId: params.accountId,
  }).resolveConversationRequireMention(params.conversationId);
  const defaultActivation = !requireMention ? "always" : "mention";
  return normalizeGroupActivation(entry?.groupActivation) ?? defaultActivation;
}
