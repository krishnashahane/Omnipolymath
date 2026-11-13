import type { PluginCompatRecord } from "./types.js";

/**
 * JavaScript-only SDK facades are not typed contracts, but published plugins link these names;
 * the contract test asserts each surface stays exported from its packaged subpath.
 */
export const PLUGIN_SDK_PRIVATE_RUNTIME_EXPORT_COMPAT_RECORD = {
  code: "plugin-sdk-private-runtime-shipped-exports",
  status: "deprecated",
  owner: "sdk",
  deprecated: "2026-10-15",
  warningStarts: "2026-10-15",
  removeAfter: "2027-01-15",
  replacement:
    "Import the helper from a typed public SDK subpath that exports it, or keep a plugin-local copy; these JavaScript-only runtime facades are not a typed third-party contract",
  docsPath: "/plugins/sdk-migration/compatibility-policy#private-runtime-facade-exports",
  surfaces: [
    "omnipolymath/plugin-sdk/acp-runtime.getAcpRuntimeBackend",
    "omnipolymath/plugin-sdk/approval-reaction-runtime.readApprovalReactionDeliveryMetadata",
    "omnipolymath/plugin-sdk/fetch-runtime.hasEnvHttpProxyConfigured",
    "omnipolymath/plugin-sdk/image-generation-core.resolveAgentModelPrimaryValue",
    "omnipolymath/plugin-sdk/image-generation-core.resolveApiKeyForProvider",
    "omnipolymath/plugin-sdk/memory-core-host-engine-embeddings.fetchRemoteEmbeddingVectors",
    "omnipolymath/plugin-sdk/memory-core-host-engine-embeddings.listMemoryEmbeddingProviders",
    "omnipolymath/plugin-sdk/memory-core-host-engine-storage.chunkMarkdown",
    "omnipolymath/plugin-sdk/memory-core-host-engine-storage.ensureDir",
    "omnipolymath/plugin-sdk/memory-core-host-runtime-files.listMemoryFiles",
    "omnipolymath/plugin-sdk/memory-core-host-runtime-files.normalizeExtraMemoryPaths",
    "omnipolymath/plugin-sdk/poll-runtime.resolvePollMaxSelections",
    "omnipolymath/plugin-sdk/provider-stream.createOpenRouterSystemCacheWrapper",
    "omnipolymath/plugin-sdk/provider-stream.resolveMoonshotThinkingType",
    "omnipolymath/plugin-sdk/provider-web-fetch.enablePluginInConfig",
    "omnipolymath/plugin-sdk/provider-web-fetch.jsonResult",
    "omnipolymath/plugin-sdk/provider-web-fetch.withTrustedWebToolsEndpoint",
    "omnipolymath/plugin-sdk/provider-web-fetch.wrapExternalContent",
    "omnipolymath/plugin-sdk/provider-web-fetch.wrapWebContent",
    "omnipolymath/plugin-sdk/provider-web-search.DEFAULT_TIMEOUT_SECONDS",
    "omnipolymath/plugin-sdk/provider-web-search.markdownToText",
    "omnipolymath/plugin-sdk/provider-web-search.setScopedCredentialValue",
    "omnipolymath/plugin-sdk/provider-web-search.setTopLevelCredentialValue",
    "omnipolymath/plugin-sdk/retry-runtime.createRateLimitRetryRunner",
    "omnipolymath/plugin-sdk/speech.readResponseTextLimited",
    "omnipolymath/plugin-sdk/speech.truncateErrorDetail",
    "omnipolymath/plugin-sdk/thread-bindings-runtime.resolveThreadBindingConversationIdFromBindingId",
    "omnipolymath/plugin-sdk/thread-bindings-runtime.resolveThreadBindingFarewellText",
    "omnipolymath/plugin-sdk/thread-bindings-runtime.resolveThreadBindingLifecycle",
  ],
  diagnostics: [
    "TypeScript @deprecated annotations and the private runtime shipped-export contract test",
  ],
} as const satisfies PluginCompatRecord;
