import { asFiniteNumber } from "@omnipolymath/normalization-core/number-coercion";
import {
  asOptionalRecord,
  asOptionalObjectRecord,
} from "@omnipolymath/normalization-core/record-coerce";
import {
  extractAssistantPhaseText,
  extractFirstTextBlock,
  readTerminalSourceReplyDeliveryMirror,
  resolveAssistantMessagePhase,
} from "../../shared/chat-message-content.js";
import {
  CRON_DIRECT_DELIVERY_CONTEXT_KIND,
  isTranscriptOnlyOmnipolymathAssistantMessage,
} from "../../shared/transcript-only-omnipolymath-assistant.js";
import type { TranscriptEvent } from "./session-accessor.sqlite-contract.js";
import type {
  SessionTranscriptBoundedMessageTailOptions,
  SessionTranscriptBoundedMessageTailPage,
} from "./session-accessor.sqlite-projection-read.js";

function readPreferredUpstreamUserText(message: {
  __omnipolymath?: unknown;
}): string | null | undefined {
  const meta = asOptionalObjectRecord(message["__omnipolymath"]);
  if (typeof meta?.upstreamUserText === "string") {
    return meta.upstreamUserText.trim();
  }
  return meta?.mirrorOrigin ? null : undefined;
}

export type SessionRecentConversationText = {
  id?: string;
  role: "user" | "assistant";
  text: string;
  timestamp?: number;
  sourceChannel?: string;
};

/** Internal channel-history evidence, not part of the Plugin SDK text projection. */
export type SessionRecentConversationTurn = SessionRecentConversationText & {
  messageId?: string;
  isCompletedAnswer?: true;
};

export type ReadRecentSessionConversationTextOptions = {
  beforeTimestampMs?: number;
  includeCronDirectDeliveryContext?: boolean;
  includeMessageToolSourceReplies?: boolean;
  limit?: number;
  minTimestampMs?: number;
  role?: "user" | "assistant";
  preferUpstreamUserText?: boolean;
};

export type ReadRecentSessionConversationTurnOptions = ReadRecentSessionConversationTextOptions & {
  includeTurnIdentity?: boolean;
};

function extractRecentConversationText(
  event: TranscriptEvent,
  options: ReadRecentSessionConversationTurnOptions = {},
): SessionRecentConversationTurn | undefined {
  const parsed = asOptionalRecord(event);
  const message = asOptionalRecord(parsed?.message);
  if (
    !message ||
    (message.role !== "user" && message.role !== "assistant") ||
    (options.role && message.role !== options.role)
  ) {
    return undefined;
  }
  const deliveryMirror = message.omnipolymathDeliveryMirror;
  const includeCronDirectDeliveryContext =
    options.includeCronDirectDeliveryContext === true &&
    deliveryMirror !== null &&
    typeof deliveryMirror === "object" &&
    !Array.isArray(deliveryMirror) &&
    "kind" in deliveryMirror &&
    deliveryMirror.kind === CRON_DIRECT_DELIVERY_CONTEXT_KIND;
  if (
    message.role === "assistant" &&
    isTranscriptOnlyOmnipolymathAssistantMessage(message) &&
    !includeCronDirectDeliveryContext &&
    !(options.includeMessageToolSourceReplies && readTerminalSourceReplyDeliveryMirror(message))
  ) {
    return undefined;
  }
  const upstreamUserText =
    options.preferUpstreamUserText && message.role === "user"
      ? readPreferredUpstreamUserText(message)
      : undefined;
  if (upstreamUserText === null) {
    return undefined;
  }
  const text =
    message.role === "assistant"
      ? extractAssistantPhaseText(message)
      : (upstreamUserText ?? extractFirstTextBlock(message)?.trim());
  if (!text) {
    return undefined;
  }
  const provenance = asOptionalRecord(message.provenance);
  const timestamp = asFiniteNumber(message.timestamp);
  const entry: SessionRecentConversationTurn = {
    ...(typeof parsed?.id === "string" && parsed.id ? { id: parsed.id } : {}),
    role: message.role,
    text,
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(typeof provenance?.sourceChannel === "string" && provenance.sourceChannel.trim()
      ? { sourceChannel: provenance.sourceChannel.trim() }
      : {}),
  };
  if (options.includeTurnIdentity) {
    const metadata = asOptionalRecord(message["__omnipolymath"]);
    const messageId =
      message.role === "user" ? asOptionalRecord(metadata?.transport)?.messageId : undefined;
    if (typeof messageId === "string" && messageId) {
      entry.messageId = messageId;
    }
    // Native narration can stop too; only a terminal mirror or final reply proves completion.
    if (
      message.role === "assistant" &&
      (readTerminalSourceReplyDeliveryMirror(message) ||
        (message.stopReason === "stop" &&
          !message.errorMessage &&
          resolveAssistantMessagePhase(message) !== "commentary" &&
          message.omnipolymathStreamFallback === undefined &&
          message.omnipolymathAsyncDelivery === undefined &&
          (metadata?.mirrorOrigin === undefined || metadata.runTerminal === true)))
    ) {
      entry.isCompletedAnswer = true;
    }
  }
  return entry;
}

/** Select recent text inside the caller's single transcript snapshot. */
export function readRecentTranscriptConversationText(
  readPage: (
    options: SessionTranscriptBoundedMessageTailOptions,
  ) => SessionTranscriptBoundedMessageTailPage,
  options: ReadRecentSessionConversationTurnOptions = {},
): SessionRecentConversationTurn[] {
  const limit = Math.max(1, Math.floor(options.limit ?? 10));
  const pageSize = 250;
  const recent: SessionRecentConversationTurn[] = [];
  for (let offset = 0; recent.length < limit; offset += pageSize) {
    const page = readPage({ maxMessages: pageSize, maxBytes: Number.MAX_SAFE_INTEGER, offset });
    for (const event of page.events.toReversed()) {
      const entry = extractRecentConversationText(event.event, options);
      if (
        entry &&
        (options.beforeTimestampMs === undefined ||
          entry.timestamp === undefined ||
          entry.timestamp < options.beforeTimestampMs) &&
        (options.minTimestampMs === undefined ||
          entry.timestamp === undefined ||
          entry.timestamp >= options.minTimestampMs)
      ) {
        recent.push(entry);
        if (recent.length >= limit) {
          break;
        }
      }
    }
    if (offset + page.scannedMessages >= page.totalMessages) {
      break;
    }
  }
  return recent.toReversed();
}
