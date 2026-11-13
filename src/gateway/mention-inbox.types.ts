import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import type { GatewayScheduler } from "../infra/gateway-scheduler.js";
import type { GatewayBroadcastToConnIdsFn } from "./server-broadcast-types.js";
import type { GatewayClient } from "./server-methods/client-types.js";

export type { MentionCommittedInput } from "./mention-inbox-input.js";

type MentionNotification = {
  id: string;
  recipientProfileId: string;
  sessionKey: string;
  agentId: string;
  senderLabel: string;
  sessionTitle: string;
  prepare: () => Promise<void>;
  isCurrent: () => boolean;
};

export type MentionInboxOptions = {
  scheduler: GatewayScheduler;
  gatewayInstanceId: string;
  getRuntimeConfig: () => OmnipolymathConfig;
  getClients: () => Iterable<GatewayClient>;
  broadcastToConnIds: GatewayBroadcastToConnIdsFn;
  onMentionCreated?: (notification: MentionNotification) => void;
};

export type { MentionInbox } from "./mention-inbox.contracts.js";
