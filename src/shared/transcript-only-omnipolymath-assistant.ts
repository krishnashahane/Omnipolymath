import { asOptionalRecord } from "@omnipolymath/normalization-core/record-coerce";
import { OMNIPOLYMATH_TRANSCRIPT_ARTIFACT_PROVIDER } from "../../packages/agent-core/src/harness/session/transcript-model.js";
import { MODEL_FALLBACK_NOTICE_KIND } from "./model-fallback-notice.js";

export { OMNIPOLYMATH_TRANSCRIPT_ARTIFACT_PROVIDER } from "../../packages/agent-core/src/harness/session/transcript-model.js";

// Identifies Omnipolymath-authored assistant rows that are transcript bookkeeping,
// not provider model output. Some history surfaces keep gateway-injected rows
// visible, so use the narrower delivery-mirror predicate when visibility matters.
export const OMNIPOLYMATH_TRANSCRIPT_ARTIFACT_API = "omnipolymath-transcript" as const;
export const OMNIPOLYMATH_DELIVERY_MIRROR_MODEL = "delivery-mirror" as const;
export const SUBAGENT_COMPLETION_DIRECT_DELIVERY_KIND = "subagent-completion-direct" as const;
/** Model-visible background result rows written by the destination history owner. */
export const AUTOMATION_RESULT_MODEL = "automation-result" as const;
export const SUBAGENT_COMPLETION_RESULT_KIND = "subagent-completion" as const;
export const CRON_DIRECT_DELIVERY_CONTEXT_KIND = "cron-direct-delivery-context" as const;
/** Marker kind of a plugin-posted notice; `plugin-notice.ts` owns its shape. */
export const PLUGIN_NOTICE_KIND = "plugin-notice" as const;
const OMNIPOLYMATH_GATEWAY_INJECTED_MODEL = "gateway-injected" as const;

const TRANSCRIPT_ONLY_OMNIPOLYMATH_ASSISTANT_MODELS = new Set<string>([
  OMNIPOLYMATH_DELIVERY_MIRROR_MODEL,
  OMNIPOLYMATH_GATEWAY_INJECTED_MODEL,
]);
const OMNIPOLYMATH_DELIVERY_MIRROR_KINDS = new Set([
  "channel-final",
  "channel-final-suppressed",
  "message-tool-source-reply",
  CRON_DIRECT_DELIVERY_CONTEXT_KIND,
  SUBAGENT_COMPLETION_DIRECT_DELIVERY_KIND,
  PLUGIN_NOTICE_KIND,
  MODEL_FALLBACK_NOTICE_KIND,
]);

function isOmnipolymathDeliveryMirrorMarker(value: unknown): boolean {
  const kind = asOptionalRecord(value)?.kind;
  return typeof kind === "string" && OMNIPOLYMATH_DELIVERY_MIRROR_KINDS.has(kind);
}

export function isTranscriptOnlyOmnipolymathAssistantModel(provider: unknown, model: unknown): boolean {
  return (
    provider === OMNIPOLYMATH_TRANSCRIPT_ARTIFACT_PROVIDER &&
    typeof model === "string" &&
    TRANSCRIPT_ONLY_OMNIPOLYMATH_ASSISTANT_MODELS.has(model)
  );
}

/**
 * Returns true when the message is an Omnipolymath-authored transcript artifact
 * that must not be replayed to providers.
 *
 * Primary check: provider="omnipolymath" + model in known transcript-only set.
 * Fallback: a valid omnipolymathDeliveryMirror marker catches observed historical
 * rows whose provider/model provenance was stripped (#99470).
 */
export function isTranscriptOnlyOmnipolymathAssistantMessage(message: unknown): boolean {
  const entry = asOptionalRecord(message);
  if (entry?.role !== "assistant") {
    return false;
  }
  if (isTranscriptOnlyOmnipolymathAssistantModel(entry.provider, entry.model)) {
    return true;
  }
  return isOmnipolymathDeliveryMirrorMarker(entry.omnipolymathDeliveryMirror);
}

export function isOmnipolymathMessageToolMirrorAssistantMessage(message: unknown): boolean {
  const entry = asOptionalRecord(message);
  return entry?.role === "assistant" && entry.omnipolymathMessageToolMirror !== undefined;
}

export function isOmnipolymathDeliveryMirrorAssistantMessage(message: unknown): boolean {
  const entry = asOptionalRecord(message);
  return (
    entry?.role === "assistant" &&
    entry.provider === OMNIPOLYMATH_TRANSCRIPT_ARTIFACT_PROVIDER &&
    entry.model === OMNIPOLYMATH_DELIVERY_MIRROR_MODEL
  );
}

/** Matches a delivered subagent completion row: a canonical result or a retained mirror. */
export function isOmnipolymathSubagentCompletionMirrorAssistantMessage(message: unknown): boolean {
  const entry = asOptionalRecord(message);
  if (
    entry?.role === "assistant" &&
    entry.provider === OMNIPOLYMATH_TRANSCRIPT_ARTIFACT_PROVIDER &&
    entry.model === AUTOMATION_RESULT_MODEL &&
    asOptionalRecord(entry.omnipolymathAutomation)?.kind === SUBAGENT_COMPLETION_RESULT_KIND
  ) {
    return true;
  }
  return (
    isOmnipolymathDeliveryMirrorAssistantMessage(entry) &&
    asOptionalRecord(entry?.omnipolymathDeliveryMirror)?.kind ===
      SUBAGENT_COMPLETION_DIRECT_DELIVERY_KIND
  );
}
