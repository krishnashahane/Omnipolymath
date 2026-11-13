export { buildGuardedModelFetch } from "../agents/provider-transport-fetch.js";
export { buildOpenAICompletionsParams } from "../agents/openai-transport-stream.js";
export { buildAssistantMessage } from "../agents/stream-message-shared.js";
/** @deprecated Bundled provider option composition; not a third-party SDK contract. */
export { applyAnthropicThinkingOptions } from "@omnipolymath/ai/internal/anthropic";
/** @deprecated Bundled provider transport primitives; not a third-party SDK contract. */
export { clampMaxTokensToModel, iterateSseFrames } from "@omnipolymath/ai/internal/shared";
export {
  sortPromptCacheToolsByName,
  splitSystemPromptCacheBoundary,
  splitSystemPromptRelocatableBoundary,
  stripSystemPromptCacheBoundary,
} from "@omnipolymath/ai/internal/shared";
export { transformTransportMessages } from "../agents/transport-message-transform.js";
export {
  describeToolResultMediaPlaceholder,
  describeUnsupportedToolResultMedia,
  extractToolResultText,
  formatToolResultText,
  isImageWithMediaPayload,
} from "@omnipolymath/ai/internal/shared";
export {
  buildGoogleGenerationConfig,
  buildGoogleSimpleThinking,
} from "@omnipolymath/ai/internal/google";
export {
  applyProviderPayloadHook,
  coerceTransportToolCallArguments,
  consumeGoogleGenerateContentStream,
  convertGoogleTools,
  createGoogleVideoPlaceholder,
  GOOGLE_VIDEO_SLOT_OMISSION,
  materializeGoogleVideoSlots,
  type GoogleVideoSlots,
  projectGoogleMessages,
  requiresGoogleToolCallId,
  type GoogleStreamChunk,
  copyProviderAcceptanceObserver,
  createEmptyTransportUsage,
  createWritableTransportEventStream,
  createProviderWaitObserver,
  failTransportStream,
  finalizeTerminalToolCallArguments,
  finalizeTransportStream,
  MALFORMED_STREAMING_FRAGMENT_ERROR_MESSAGE,
  mergeTransportHeaders,
  notifyProviderHttpMetadata,
  notifyProviderHttpResponse,
  notifyProviderStreamOpened,
  parseTerminalToolCallArguments,
  sanitizeTransportPayloadText,
  withProviderAcceptanceObserver,
  type WritableTransportStream,
} from "@omnipolymath/ai/transports";
