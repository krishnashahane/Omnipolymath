// All public plugin SDK contracts are experimental; see docs/plugins/sdk-overview.md#api-stability.
import { emptyPluginConfigSchema } from "../plugins/config-schema.js";
import type {
  OmnipolymathPluginConfigSchema,
  OmnipolymathPluginDefinition,
  ProviderBuiltInModelSuppressionContext as ProviderBuiltInModelSuppressionContextType,
} from "../plugins/types.js";
import { createCachedLazyValueGetter } from "./lazy-value.js";

export type {
  StorageProvider,
  StorageProviderOpenParams,
  StorageBackend,
  StorageObjectInfo,
} from "../storage/types.js";
export type {
  PluginCapabilityCatalogContext,
  PluginCapabilityCatalogEntry,
  PluginCapabilityCatalogHostContext,
  PluginCapabilityCatalogHostEntry,
} from "../plugins/capability-catalog-context.types.js";
export type { PluginCapabilityCatalog } from "../plugins/capability-catalog.types.js";
export type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
export type {
  SuggestedWorkerProfile,
  WorkerProfileSuggestionDiscovery,
} from "../plugins/worker-profile-suggestion.types.js";

export type {
  AgentHarness,
  AgentPromptGuidance,
  AgentPromptGuidanceEntry,
  AgentPromptSurfaceKind,
  AnyAgentTool,
  MediaUnderstandingProviderPlugin,
  MigrationApplyResult,
  MigrationDetection,
  MigrationItem,
  MigrationPlan,
  MigrationProviderContext,
  MigrationProviderPlugin,
  MigrationSummary,
  OmnipolymathGatewayDiscoveryAdvertiseContext,
  OmnipolymathGatewayDiscoveryService,
  OmnipolymathPluginApi,
  OmnipolymathPluginCommandDefinition,
  OmnipolymathPluginConfigSchema,
  OmnipolymathPluginDefinition,
  OmnipolymathPluginHttpRouteHandler,
  OmnipolymathPluginNodeHostCommand,
  OmnipolymathPluginNodeHostCommandAvailabilityContext,
  OmnipolymathPluginNodeInvokePolicy,
  OmnipolymathPluginNodeInvokePolicyContext,
  OmnipolymathPluginNodeInvokePolicyResult,
  OmnipolymathPluginReloadRegistration,
  OmnipolymathPluginSecurityAuditCollector,
  OmnipolymathPluginSecurityAuditContext,
  OmnipolymathPluginService,
  OmnipolymathPluginServiceContext,
  OmnipolymathPluginServiceContextV2,
  OmnipolymathPluginServiceV2,
  OmnipolymathPluginServiceV3,
  OmnipolymathPluginServiceContextV3,
  PluginServiceSessionWorkV1,
  PluginServiceSessionWorkContextV1,
  OmnipolymathPluginToolContext,
  OmnipolymathPluginToolFactory,
  PluginAgentEventEmitParams,
  PluginAgentEventEmitResult,
  PluginAgentEventSubscriptionRegistration,
  PluginAgentTurnPrepareEvent,
  PluginAgentTurnPrepareResult,
  PluginCommandContext,
  PluginCommandResult,
  PluginControlUiDescriptor,
  PluginHeartbeatPromptContributionEvent,
  PluginHeartbeatPromptContributionResult,
  PluginJsonValue,
  PluginLogger,
  PluginNextTurnInjection,
  PluginNextTurnInjectionEnqueueResult,
  PluginNextTurnInjectionRecord,
  PluginRunContextGetParams,
  PluginRunContextPatch,
  PluginRuntimeLifecycleRegistration,
  PluginServiceSchedulerV1,
  PluginSessionActionContext,
  PluginSessionActionRegistration,
  PluginSessionActionResult,
  PluginSessionAttachmentParams,
  PluginSessionAttachmentResult,
  PluginSessionExtensionProjection,
  PluginSessionExtensionRegistration,
  PluginSessionSchedulerJobHandle,
  PluginSessionSchedulerJobRegistration,
  PluginSessionTurnScheduleParams,
  PluginSessionTurnUnscheduleByTagParams,
  PluginSessionTurnUnscheduleByTagResult,
  PluginToolMetadataRegistration,
  PluginTrustedToolPolicyRegistration,
  ProviderApplyConfigDefaultsContext,
  ProviderAugmentModelCatalogContext,
  ProviderAppGuidedSetup,
  ProviderAppGuidedSetupCandidate,
  ProviderAppGuidedSetupContext,
  ProviderAuthContext,
  ProviderAuthDoctorHintContext,
  ProviderAuthMethod,
  ProviderAuthMethodNonInteractiveContext,
  ProviderAuthResult,
  ProviderBuildMissingAuthMessageContext,
  ProviderBuildUnknownModelHintContext,
  ProviderBuiltInModelSuppressionResult,
  ProviderCacheTtlEligibilityContext,
  ProviderCatalogContext,
  ProviderCatalogResult,
  ProviderDefaultThinkingPolicyContext,
  ProviderDeferSyntheticProfileAuthContext,
  ProviderFailoverErrorContext,
  ProviderFetchUsageSnapshotContext,
  ProviderModernModelPolicyContext,
  ProviderNormalizeConfigContext,
  ProviderNormalizeModelIdContext,
  ProviderNormalizeResolvedModelContext,
  ProviderNormalizeToolSchemasContext,
  ProviderNormalizeTransportContext,
  // The plugin-authoring scaffold imports ProviderPlugin from this entrypoint.
  ProviderPlugin,
  ProviderPrepareDynamicModelContext,
  ProviderPrepareExtraParamsContext,
  ProviderPrepareRuntimeAuthContext,
  ProviderPrepareRuntimeAuthContextV2,
  ProviderRuntimeAuthModel,
  ProviderPreparedRuntimeAuth,
  ProviderReconcileLocalServiceContext,
  ProviderReasoningOutputMode,
  ProviderReasoningOutputModeContext,
  ProviderReplayPolicy,
  ProviderReplayPolicyContext,
  ProviderReplaySessionEntry,
  ProviderReplaySessionState,
  ProviderReplaySessionStateV2,
  ProviderResolveConfigApiKeyContext,
  ProviderResolveDynamicModelContext,
  ProviderResolveTransportTurnStateContext,
  ProviderResolveUsageAuthContext,
  ProviderResolveWebSocketSessionPolicyContext,
  ProviderResolvedUsageAuth,
  ProviderSanitizeReplayHistoryContext,
  ProviderSanitizeReplayHistoryContextV2,
  ProviderThinkingPolicyContext,
  ProviderThinkingProfile,
  ProviderToolSchemaDiagnostic,
  ProviderTransportTurnState,
  ProviderUsageAuthToken,
  ProviderValidateReplayTurnsContext,
  ProviderWebSocketSessionPolicy,
  ProviderWrapStreamFnContext,
  RealtimeTranscriptionProviderPlugin,
  SpeechProviderPlugin,
  TranscriptSourceProvider,
  UnifiedModelCatalogProviderContext,
  UnifiedModelCatalogProviderPlugin,
  WorkerDesktopApp,
  WorkerDesktopEndpoint,
  WorkerLease,
  WorkerLeaseStatus,
  WorkerResourceReceipt,
  WorkerRetentionObservation,
  WorkerRetentionOperation,
  WorkerRetentionPolicy,
  WorkerMachineOption,
  WorkerProfile,
  WorkerProvider,
  WorkerSshEndpoint,
  WorkerSshIdentity,
  WorkerSshIdentityRequest,
} from "../plugins/types.js";

// A direct re-export would inherit upstream @deprecated metadata, while this
// entrypoint's established surface exposes the same type without deprecating it.
export type ProviderBuiltInModelSuppressionContext = ProviderBuiltInModelSuppressionContextType;

export type {
  OmnipolymathPluginGatewayEventScope,
  OmnipolymathPluginGatewayEvents,
} from "../plugins/gateway-events.js";
export { WorkerProviderError } from "../plugins/capability-provider.types.js";

export type {
  PluginConversationBinding,
  PluginConversationBindingResolvedEvent,
  PluginConversationBindingRequestParams,
  PluginConversationBindingRequestResult,
} from "../plugins/conversation-binding.types.js";
export type {
  PluginHookInboundClaimContext,
  PluginHookInboundClaimEvent,
  PluginHookInboundClaimResult,
  PluginHookInboundMessageMetadata,
  PluginHookLocation,
  PluginHookMediaFact,
  PluginHookMessageReceivedEvent,
  PluginHookProviderUpdate,
  PluginHookSkillArtifact,
  PluginHookSkillChangedEvent,
  PluginHookSkillContext,
} from "../plugins/hook-types.js";
export type { ProviderRuntimeModel } from "../plugins/provider-runtime-model.types.js";
export type {
  UnifiedModelCatalogEntry,
  UnifiedModelCatalogKind,
  UnifiedModelCatalogSource,
} from "@omnipolymath/model-catalog-core/model-catalog-types";

export {
  buildJsonPluginConfigSchema,
  buildPluginConfigSchema,
  emptyPluginConfigSchema,
} from "../plugins/config-schema.js";

/** Options for a plugin entry that registers providers, tools, commands, or services. */
type DefinePluginEntryOptions = {
  id: string;
  name: string;
  description: string;
  /**
   * @deprecated Declare exclusive plugin kind in `omnipolymath.plugin.json` via
   * manifest `kind`. Runtime-entry `kind` remains only as a compatibility
   * fallback for older plugins.
   */
  kind?: OmnipolymathPluginDefinition["kind"];
  configSchema?: OmnipolymathPluginConfigSchema | (() => OmnipolymathPluginConfigSchema);
  reload?: OmnipolymathPluginDefinition["reload"];
  nodeHostCommands?: OmnipolymathPluginDefinition["nodeHostCommands"];
  securityAuditCollectors?: OmnipolymathPluginDefinition["securityAuditCollectors"];
  register: NonNullable<OmnipolymathPluginDefinition["register"]>;
};

/** Normalized object shape that Omnipolymath loads from a plugin entry module. */
type DefinedPluginEntry = Omit<DefinePluginEntryOptions, "configSchema"> & {
  configSchema: OmnipolymathPluginConfigSchema;
};

/**
 * Canonical entry helper for non-channel plugins.
 *
 * Use this for provider, tool, command, service, memory, and context-engine
 * plugins. Channel plugins should use `defineChannelPluginEntry(...)` from
 * `omnipolymath/plugin-sdk/core` so they inherit the channel capability wiring.
 *
 * @experimental Pin and test Omnipolymath host versions; existing compatibility windows still apply.
 */
export function definePluginEntry({
  id,
  name,
  description,
  kind,
  configSchema = emptyPluginConfigSchema,
  reload,
  nodeHostCommands,
  securityAuditCollectors,
  register,
}: DefinePluginEntryOptions): DefinedPluginEntry {
  const getConfigSchema = createCachedLazyValueGetter(configSchema);
  return {
    id,
    name,
    description,
    ...(kind ? { kind } : {}),
    ...(reload ? { reload } : {}),
    ...(nodeHostCommands ? { nodeHostCommands } : {}),
    ...(securityAuditCollectors ? { securityAuditCollectors } : {}),
    get configSchema() {
      return getConfigSchema();
    },
    register,
  };
}

export type {
  PluginHookBeforeChannelIngressContext,
  PluginHookBeforeChannelIngressEvent,
  PluginHookBeforeChannelIngressResult,
} from "../plugins/hook-message.types.js";

export type {
  RepositoryIntegration,
  RepositoryActor,
  RepositoryOperation,
  RepositoryCredentialScope,
  RepositoryConnectionIdentity,
  RepositoryAdmission,
} from "../plugins/repository-integration.types.js";
