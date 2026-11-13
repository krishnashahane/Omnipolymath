/** Types for test controls at the real Telegram/SDK module boundaries. */
export type TelegramBotFixtureMocks = {
  getRuntimeConfig: typeof import("omnipolymath/plugin-sdk/runtime-config-snapshot").readRuntimeConfig;
  resolveStorePath: typeof import("omnipolymath/plugin-sdk/session-store-runtime").resolveStorePath;
  getSessionEntryAsync: typeof import("omnipolymath/plugin-sdk/session-store-runtime").getSessionEntryAsync;
  readChannelAllowFromStore: typeof import("omnipolymath/plugin-sdk/conversation-runtime").readChannelAllowFromStore;
  readSessionUpdatedAtAsync: typeof import("omnipolymath/plugin-sdk/session-store-runtime").readSessionUpdatedAtAsync;
  readAmbientTranscriptWatermarkAsync: typeof import("omnipolymath/plugin-sdk/session-store-runtime").readAmbientTranscriptWatermarkAsync;
  resolveAmbientTranscriptWatermarkKey: typeof import("omnipolymath/plugin-sdk/session-store-runtime").resolveAmbientTranscriptWatermarkKey;
  recordInboundSession: typeof import("omnipolymath/plugin-sdk/conversation-runtime").recordInboundSession;
  recordChannelActivity: typeof import("omnipolymath/plugin-sdk/channel-activity-runtime").recordChannelActivity;
  resolveInboundLastRouteSessionKey: typeof import("omnipolymath/plugin-sdk/routing").resolveInboundLastRouteSessionKey;
  resolvePinnedMainDmOwnerFromAllowlist: typeof import("omnipolymath/plugin-sdk/security-runtime").resolvePinnedMainDmOwnerFromAllowlist;
  buildChannelInboundEventContext: typeof import("omnipolymath/plugin-sdk/channel-inbound").buildChannelInboundEventContext;
  upsertChannelPairingRequest: typeof import("omnipolymath/plugin-sdk/conversation-runtime").upsertChannelPairingRequest;
  enqueueRoutedSystemEvent: typeof import("omnipolymath/plugin-sdk/system-event-runtime").enqueueRoutedSystemEvent;
  dispatchReplyWithBufferedBlockDispatcher: typeof import("omnipolymath/plugin-sdk/reply-dispatch-runtime").dispatchReplyWithBufferedBlockDispatcher;
  loadWebMedia: typeof import("omnipolymath/plugin-sdk/web-media").loadWebMedia;
  buildModelsProviderData: typeof import("omnipolymath/plugin-sdk/models-provider-runtime").buildPreparedModelsProviderData;
  prepareSkillCommandsForAgents: typeof import("omnipolymath/plugin-sdk/skill-commands-runtime").prepareSkillCommandsForAgents;
  syncTelegramMenuCommands: typeof import("./bot-native-command-menu.js").syncTelegramMenuCommands;
  wasSentByBot: (
    ...args: Parameters<typeof import("./sent-message-cache.js").wasSentByBot>
  ) => boolean | Promise<boolean>;
  resolveApproval: (
    params: {
      cfg: import("omnipolymath/plugin-sdk/config-contracts").OmnipolymathConfig;
      approvalId: string;
      decision: import("omnipolymath/plugin-sdk/approval-reply-runtime").ExecApprovalReplyDecision;
      channel: "telegram";
      accountId?: string | null;
      senderId?: string | null;
      gatewayUrl?: string;
    } & (
      | {
          approvalKind: import("omnipolymath/plugin-sdk/approval-handler-runtime").ChannelApprovalKind;
          resolveMethod?: never;
        }
      | {
          approvalKind?: never;
          resolveMethod: import("omnipolymath/plugin-sdk/approval-handler-runtime").ChannelApprovalKind;
        }
    ),
  ) => Promise<import("omnipolymath/plugin-sdk/approval-gateway-runtime").ApprovalResolveResult | void>;
  createTelegramDraftStream: typeof import("./draft-stream.js").createTelegramDraftStream;
  deliverReplies: typeof import("./bot/delivery.js").deliverReplies;
  deliverStructuredReplies: typeof import("./bot/delivery.js").deliverStructuredReplies;
  deliverStructuredInboundReplyWithMessageSendContext: typeof import("omnipolymath/plugin-sdk/channel-outbound").deliverStructuredInboundReplyWithMessageSendContext;
  emitTelegramMessageSentHooks: typeof import("./bot/delivery.js").emitTelegramMessageSentHooks;
  editMessageTelegram: typeof import("./send.js").editMessageTelegram;
  recordOutboundMessageForPromptContext: typeof import("./outbound-message-context.js").recordOutboundMessageForPromptContext;
  createChannelMessageReplyPipeline: typeof import("omnipolymath/plugin-sdk/channel-outbound").createChannelMessageReplyPipeline;
};
