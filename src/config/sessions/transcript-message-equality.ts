import { isDeepStrictEqual } from "node:util";
import { isRecord } from "@omnipolymath/normalization-core/record-coerce";
import {
  isOmnipolymathDeliveryMirrorAssistantMessage,
  OMNIPOLYMATH_TRANSCRIPT_ARTIFACT_API,
} from "../../shared/transcript-only-omnipolymath-assistant.js";

export function messagesMatchForIdempotentReplay(stored: unknown, candidate: unknown): boolean {
  const storedDelivery = isRecord(stored) ? stored.omnipolymathDelivery : undefined;
  // Shipped core and SDK mirrors did not retain URLs. Compare their original representation
  // without rewriting accepted bytes; an explicit mediaUrls field stays strict.
  const legacyMediaMirror =
    isRecord(stored) &&
    isOmnipolymathDeliveryMirrorAssistantMessage(stored) &&
    (stored.api === OMNIPOLYMATH_TRANSCRIPT_ARTIFACT_API || stored.api === "openai-responses") &&
    (storedDelivery === undefined ||
      (isRecord(storedDelivery) && !Object.hasOwn(storedDelivery, "mediaUrls")));
  const serializedShape = (message: unknown, projectLegacyMedia = false): unknown => {
    if (!isRecord(message)) {
      return message;
    }
    const { timestamp: _timestamp, ...stable } = message;
    if (
      projectLegacyMedia &&
      isRecord(stable.omnipolymathDelivery) &&
      Array.isArray(stable.omnipolymathDelivery.mediaUrls) &&
      stable.omnipolymathDelivery.mediaUrls.every((url) => typeof url === "string")
    ) {
      const { mediaUrls: _mediaUrls, ...delivery } = stable.omnipolymathDelivery;
      if (storedDelivery === undefined && Object.keys(delivery).length === 0) {
        delete stable.omnipolymathDelivery;
      } else {
        stable.omnipolymathDelivery = delivery;
      }
    }
    const serialized = JSON.stringify(stable);
    return serialized === undefined ? undefined : JSON.parse(serialized);
  };
  return isDeepStrictEqual(serializedShape(stored), serializedShape(candidate, legacyMediaMirror));
}
