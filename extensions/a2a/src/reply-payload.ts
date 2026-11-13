import {
  isHostNoticePayload,
  isReplyPayloadTerminalContent,
  type ReplyPayload,
} from "omnipolymath/plugin-sdk/reply-payload";

export function filterA2aReplyPayload(payload: ReplyPayload): ReplyPayload | null {
  return isHostNoticePayload(payload) || !isReplyPayloadTerminalContent(payload) ? null : payload;
}
