import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { Result } from "@omnipolymath/normalization-core/result";
import type { Command } from "commander";
import type { MessageReceipt } from "../channels/message/types.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import type { ApprovalScope } from "../infra/approval-scope.js";
import type { InternalDiagnosticEventInterest } from "../infra/diagnostic-event-listener-presence.js";
import type {
  DiagnosticEventPrivateData,
  DiagnosticEventInput,
  DiagnosticEventMetadata,
  DiagnosticEventPayload,
} from "../infra/diagnostic-events.js";
import type { DiagnosticTracePropagationBridge as DiagnosticTracePropagationBridgeContract } from "../infra/diagnostic-trace-propagation.js";
import type { SecurityAuditFinding } from "../security/audit.types.js";
import type { DeliveryContext } from "../utils/delivery-context.types.js";
import type { PluginLogger } from "./logger-types.js";
import type { PluginManifestCliCommand } from "./manifest-types.js";
import type { PluginServiceSchedulerV1 } from "./service-scheduler.types.js";
import type { OmnipolymathPluginNodeWorkspace } from "./types.node-host.js";

export type { PluginServiceSchedulerV1 } from "./service-scheduler.types.js";

export type PluginInteractiveRegistration<
  TContext = unknown,
  TChannel extends string = string,
  TResult = {
    handled?: boolean;
  } | void,
> = {
  channel: TChannel;
  namespace: string;
  handler: (ctx: TContext) => Promise<TResult> | TResult;
};

export type PluginInteractiveHandlerRegistration = PluginInteractiveRegistration;

export type OmnipolymathPluginHttpRouteAuth = "gateway" | "plugin";
export type OmnipolymathPluginHttpRouteMatch = "exact" | "prefix";
export type OmnipolymathPluginGatewayRuntimeScopeSurface = "write-default" | "trusted-operator";

export type OmnipolymathPluginHttpRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<boolean | void> | boolean | void;

export type OmnipolymathPluginHttpRouteUpgradeHandler = (
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => Promise<boolean | void> | boolean | void;

export type OmnipolymathPluginHttpRouteParams = {
  path: string;
  handler: OmnipolymathPluginHttpRouteHandler;
  handleUpgrade?: OmnipolymathPluginHttpRouteUpgradeHandler;
  auth: OmnipolymathPluginHttpRouteAuth;
  match?: OmnipolymathPluginHttpRouteMatch;
  gatewayRuntimeScopeSurface?: OmnipolymathPluginGatewayRuntimeScopeSurface;
  nodeCapability?: {
    surface: string;
    ttlMs?: number;
  };
  replaceExisting?: boolean;
};

export type WidgetPresenterContext = Readonly<{
  messageChannel?: string;
  accountId?: string;
  deliveryContext?: Readonly<DeliveryContext>;
  nativeChannelId?: string;
  currentChannelId?: string;
  currentMessagingTarget?: string;
  /** Channel-local id of the inbound message this turn answers. */
  currentMessageId?: string;
  sessionKey?: string;
}>;

export type WidgetPresenterDocument = Readonly<{
  kind: "html";
  /** Core-wrapped document for hosts that run widgets inside Omnipolymath's iframe bridge. */
  html: string;
  /** Agent-authored widget code before wrapping, for hosts with their own widget runtime. */
  source: string;
  hostedUrl?: string;
}>;

export type WidgetPresentationError =
  | { code: "no_eligible_node"; message: string }
  | { code: "node_error"; message: string; nodeId?: string }
  | { code: "unavailable"; message: string }
  | { code: "presentation_error"; message: string };

export type WidgetPresentationSuccess =
  | { kind: "node"; nodeId: string; nodeName?: string }
  | {
      kind: "message";
      receipt: MessageReceipt;
      updated?: boolean;
      /** Advisory findings for the model; the widget was still delivered. */
      notes?: readonly string[];
    };

export type WidgetPresenter = {
  description: string;
  availability: (
    context: WidgetPresenterContext,
  ) => Promise<Result<{ available: true }, WidgetPresentationError>>;
  present: (params: {
    document: WidgetPresenterDocument;
    title: string;
    /** Stable widget name: the explicit `name`, or one derived from the title. */
    name: string;
    /** Agent-written widget state, passed only to presenters that declare `capabilities.state`. */
    state?: string;
    context: WidgetPresenterContext;
  }) => Promise<Result<WidgetPresentationSuccess, WidgetPresentationError>>;
} & (
  | {
      target: "node_panel";
      match?: never;
      capabilities?: never;
    }
  | {
      target: "current_channel";
      match: (context: WidgetPresenterContext) => boolean;
      capabilities: Readonly<{
        sourceKinds: readonly string[];
        maxSourceBytes?: number;
        /**
         * Replaces the browser-host authoring rules in the `show_widget` description while this
         * presenter owns the current channel. Keep it bounded; it is part of the tool prompt.
         */
        authoringGuidance?: string;
        /** Accepts the `state` argument: a UTF-8 string of at most `maxBytes` the widget reads. */
        state?: Readonly<{ maxBytes: number; description: string }>;
      }>;
    }
);

export type OmnipolymathPluginCliContext = {
  /**
   * Command object where this plugin should register its commands.
   *
   * For root CLI registrations this is the root `omnipolymath` program. For nested
   * registrations it is the resolved parent command from `parentPath`.
   */
  program: Command;
  parentPath: readonly string[];
  config: OmnipolymathConfig;
  workspaceDir?: string;
  logger: PluginLogger;
};

export type OmnipolymathPluginCliRegistrar = (ctx: OmnipolymathPluginCliContext) => void | Promise<void>;

/**
 * Top-level CLI metadata for plugin-owned commands.
 *
 * Descriptors are the parse-time contract for lazy plugin CLI registration.
 * If you want Omnipolymath to keep a plugin command lazy-loaded while still
 * advertising it at the root CLI level, provide descriptors that cover every
 * top-level command root registered by that plugin CLI surface.
 */
type OmnipolymathPluginCliCommandDescriptor = PluginManifestCliCommand;

/** Root-command metadata that is available before a plugin registrar is activated. */
export type OmnipolymathPluginCliRootCommandDescriptor = OmnipolymathPluginCliCommandDescriptor & {
  machineOutput?: (params: { argv: readonly string[]; stdoutIsTTY: boolean }) => boolean;
};

export type OmnipolymathPluginCliRegistrationOptions =
  | {
      /** Omit or pass an empty path for root commands. */
      parentPath?: readonly [];
      commands?: readonly string[];
      descriptors?: readonly OmnipolymathPluginCliRootCommandDescriptor[];
    } /** Backward-compatible registration shape for dynamic root or nested paths. */
  | {
      parentPath?: readonly string[];
      commands?: readonly string[];
      descriptors?: readonly OmnipolymathPluginCliCommandDescriptor[];
    };

export type OmnipolymathPluginNodeCliFeatureOptions = {
  /** Explicit node feature command names owned under `omnipolymath nodes`. */
  commands?: string[];
  /**
   * Parse-time command descriptors for lazy node feature CLI registration.
   *
   * Descriptors are registered under `omnipolymath nodes`, so a descriptor named
   * `"camera"` exposes `omnipolymath nodes camera`.
   */
  descriptors?: OmnipolymathPluginCliCommandDescriptor[];
};

export type OmnipolymathPluginReloadRegistration = {
  restartPrefixes?: string[];
  hotPrefixes?: string[];
  noopPrefixes?: string[];
};

export type {
  OmnipolymathPluginNodeHostCommand,
  OmnipolymathPluginNodeHostCommandAvailabilityContext,
  OmnipolymathPluginNodeHostCommandIo,
} from "./types.node-host.js";

export type OmnipolymathPluginNodeInvokeTransportResult =
  | {
      ok: true;
      payload?: unknown;
      payloadJSON?: string | null;
    }
  | {
      ok: false;
      code?: string;
      message: string;
      details?: Record<string, unknown>;
    };

type OmnipolymathPluginNodeInvokeApprovalDecision = "allow-once" | "allow-always" | "deny";

export type OmnipolymathPluginNodeInvokePolicyContext = {
  nodeId: string;
  command: string;
  params: unknown;
  timeoutMs?: number;
  idempotencyKey?: string;
  config: OmnipolymathConfig;
  pluginConfig?: Record<string, unknown>;
  node?: {
    nodeId: string;
    displayName?: string;
    platform?: string;
    deviceFamily?: string;
    caps?: string[];
    commands?: string[];
  };
  client?: {
    connId?: string;
    scopes?: string[];
  } | null;
  risk?: {
    level: "ordinary" | "high";
    /** Stable, content-free family name; never include user or action arguments. */
    family: string;
  };
  approvals?: {
    request: (input: {
      title: string;
      description: string;
      scope?: ApprovalScope;
      severity?: "info" | "warning" | "critical";
      toolName?: string;
      toolCallId?: string;
      agentId?: string;
      sessionKey?: string;
      allowedDecisions?: readonly OmnipolymathPluginNodeInvokeApprovalDecision[];
      timeoutMs?: number;
    }) => Promise<{
      id?: string;
      decision?: OmnipolymathPluginNodeInvokeApprovalDecision | null;
    }>;
  };
  /** Full covers only the selected harness's declared node commands; undefined requires a human decision. */
  invokeNodeWithSessionFull?: (input: {
    workspace: OmnipolymathPluginNodeWorkspace;
    /** Called only after the host authorizes this exact admitted Full launch. */
    createParams: () => unknown;
  }) => Promise<OmnipolymathPluginNodeInvokeTransportResult | undefined>;
  invokeNode: (input?: {
    params?: unknown;
    /** Bind an approved launch to its admitted managed workspace, when present. */
    workspace?: OmnipolymathPluginNodeWorkspace;
    timeoutMs?: number;
    idempotencyKey?: string;
  }) => Promise<OmnipolymathPluginNodeInvokeTransportResult>;
};

export type OmnipolymathPluginNodeInvokePolicyResult =
  | Extract<OmnipolymathPluginNodeInvokeTransportResult, { ok: true }>
  | (Extract<OmnipolymathPluginNodeInvokeTransportResult, { ok: false }> & {
      unavailable?: boolean;
    });

export type OmnipolymathPluginNodeInvokePolicy = {
  commands: string[];
  /**
   * Platforms where these node-handled commands should be allowlisted by default.
   * Omit for commands that require explicit `gateway.nodes.commands.allow`.
   */
  defaultPlatforms?: Array<"ios" | "android" | "macos" | "windows" | "linux" | "unknown">;
  /**
   * Dangerous policy commands are filtered out of default allowlists unless
   * explicitly allowed by config.
   */
  dangerous?: boolean;
  /**
   * Explicitly permits one approval to cover later launches on the same managed placement.
   * The scope is a stable semantic capability key, never user or action arguments.
   */
  standingApproval?: {
    kind: "placement";
    scope: string;
  };
  /**
   * iOS foreground-restricted commands should be queued for foreground delivery
   * when an iOS node reports BACKGROUND_UNAVAILABLE.
   */
  foregroundRestrictedOnIos?: boolean;
  /**
   * Classify exact command arguments before the policy handler or node transport runs.
   * Throwing rejects the invocation before dispatch.
   */
  classifyRisk?: (
    ctx: Pick<OmnipolymathPluginNodeInvokePolicyContext, "command" | "params">,
  ) => NonNullable<OmnipolymathPluginNodeInvokePolicyContext["risk"]>;
  handle: (
    ctx: OmnipolymathPluginNodeInvokePolicyContext,
  ) => Promise<OmnipolymathPluginNodeInvokePolicyResult> | OmnipolymathPluginNodeInvokePolicyResult;
};

export type OmnipolymathPluginSecurityAuditContext = {
  config: OmnipolymathConfig;
  sourceConfig: OmnipolymathConfig;
  env: NodeJS.ProcessEnv;
  stateDir: string;
  configPath: string;
};

export type OmnipolymathPluginSecurityAuditCollector = (
  ctx: OmnipolymathPluginSecurityAuditContext,
) => SecurityAuditFinding[] | Promise<SecurityAuditFinding[]>;

export type OmnipolymathGatewayDiscoveryAdvertiseContext = {
  machineDisplayName: string;
  gatewayPort: number;
  gatewayTlsEnabled: boolean;
  gatewayTlsFingerprintSha256?: string;
  gatewayDirectReachable: boolean;
  tailnetDns?: string;
  sshPort?: number;
  cliPath?: string;
  minimal: boolean;
};

export type OmnipolymathGatewayDiscoveryService = {
  id: string;
  advertise: (
    ctx: OmnipolymathGatewayDiscoveryAdvertiseContext,
  ) => void | Promise<void | { stop?: () => void | Promise<void> }>;
};

/** Context passed to long-lived plugin services. */
export type OmnipolymathPluginServiceHealth = {
  reportFailure: (error: unknown) => void;
  clearFailure: () => void;
};

export type OmnipolymathPluginServiceContext = {
  config: OmnipolymathConfig;
  workspaceDir?: string;
  stateDir: string;
  logger: PluginLogger;
  serviceHealth?: OmnipolymathPluginServiceHealth;
  /** Gateway-owned timed work; required by the version 2 service contract. */
  scheduler?: PluginServiceSchedulerV1;
  /** Remote device-only Control UI ingress, available only to admitted trusted services. */
  controlUiIngress?: import("./gateway-ingress.types.js").GatewayControlUiIngressFactoryV2;
  /** Gateway-owned scheduler access, revoked when this service stops. */
  getCron?: () =>
    | (import("./hook-gateway.types.js").PluginHookGatewayCronService & {
        /** Only this plugin's event sources, without credentials or creator authority. */
        readEventSources?: () => Promise<
          import("../cron/event-source.js").CronEventSourceSnapshot[]
        >;
        /** Transfer a durable ingress claim into this plugin's bound Automation. */
        runEvent?: (
          id: string,
          input: Omit<import("../cron/event-source.js").CronEventRunOptions, "commitGuard"> & {
            /** Additional current source/account authority; never replaces the host guard. */
            assertCurrent: () => void;
          },
        ) => Promise<import("../cron/event-source.js").CronEventRunResult>;
        /** Admit service-owned work through the scheduler's normal run queue. */
        enqueueRun?: (
          id: string,
          mode?: import("../cron/service/state.js").CronRunMode,
        ) => Promise<import("../cron/service-contract.js").CronServiceRunResult>;
      })
    | undefined;
  /** Host-authenticated MCP Events requests bound to this plugin's persisted event source. */
  mcpEvents?: {
    /** One binding lifetime, including exact finite cleanup across benign policy refresh. */
    prepareSource: (input: {
      jobId: string;
      sourceIdentity: string;
      serverName: string;
    }) => Promise<{
      accountId: string;
      principalId: string;
      assertCurrent: () => void;
      /** Refresh current policy and credential-owner facts; retired authorization never revives. */
      revalidate: () => Promise<void>;
      request: (
        method: "server/discover" | "events/list" | "events/subscribe",
        params: Record<string, unknown>,
        signal: AbortSignal,
      ) => Promise<unknown>;
      /** Close subscribe admission and clean up this handle’s captured webhook identity. */
      unsubscribe: (signal: AbortSignal) => Promise<unknown>;
      dispose: () => void;
    }>;
  };
  /** Service-owned node calls for this plugin's commands; normal node policy still applies. */
  invokeNode?: (
    params: Omit<
      Parameters<import("./runtime/types.js").PluginRuntime["nodes"]["invoke"]>[0],
      "scopes"
    >,
  ) => Promise<unknown>;
  /** Service-owned binary transport for this plugin's duplex node commands. */
  openNodeDuplex?: (
    params: Omit<
      Parameters<import("./runtime/types.js").PluginRuntime["nodes"]["openDuplex"]>[0],
      "scopes"
    > & { assertCurrent?: () => void },
  ) => ReturnType<import("./runtime/types.js").PluginRuntime["nodes"]["openDuplex"]>;
  gatewayEvents?: import("./gateway-events.js").OmnipolymathPluginGatewayEvents;
  startupTrace?: {
    detail?: (name: string, metrics: ReadonlyArray<readonly [string, number | string]>) => void;
    measure: <T>(name: string, run: () => T | Promise<T>) => Promise<T>;
  };
  internalDiagnostics?: {
    /** Synchronous WebSocket counters; arrays and attribution are borrowed until return. */
    onGatewayWsMetrics?: (
      listener: import("../infra/gateway-ws-metrics.js").GatewayWsMetricsListener,
    ) => () => void;
    /** Synchronous worker measurements; timing fields are borrowed and must not be mutated. */
    onWorkerRequestMetrics?: (
      listener: import("../infra/worker-request-diagnostics.js").WorkerRequestMetricsListener,
    ) => () => void;
    /** Identity of the hosting process, available only while this service is active. */
    getRuntimeIdentity?: () => { processInstanceId: string; buildId?: string };
    /** Current owner-projected work; undefined while the Gateway projection is unavailable. */
    onGatewayWorkMetrics?: (
      listener: (
        snapshot: import("../infra/gateway-work-metrics.js").GatewayWorkMetricsSnapshot | undefined,
      ) => void,
    ) => () => void;
    emit: (event: DiagnosticEventInput, privateData?: DiagnosticEventPrivateData) => void;
    onEvent: (
      listener: (
        event: DiagnosticEventPayload,
        metadata: DiagnosticEventMetadata,
        privateData: DiagnosticEventPrivateData,
      ) => void,
      filter?: InternalDiagnosticEventInterest<DiagnosticEventPayload["type"]>,
      /** Defaults to true; false skips private payload copies and passes a frozen empty object. */
      options?: { includePrivateData?: boolean },
    ) => () => void;
    registerTracePropagationBridge?: (
      bridge: DiagnosticTracePropagationBridgeContract<
        DiagnosticEventPayload,
        DiagnosticEventMetadata
      >,
    ) => () => void;
  };
};

/** Background service registered by a plugin during `register(api)`. */
export type OmnipolymathPluginService = {
  apiVersion?: 1;
  id: string;
  /** Restart this service with committed config when one of these paths changes. */
  reload?: { configPrefixes: readonly string[] };
  start: (ctx: OmnipolymathPluginServiceContext) => void | Promise<void>;
  stop?: (ctx: OmnipolymathPluginServiceContext) => void | Promise<void>;
};

export type OmnipolymathPluginServiceContextV2 = OmnipolymathPluginServiceContext & {
  scheduler: PluginServiceSchedulerV1;
};

/** A service whose host must provide scheduling bound to its lifetime. */
export type OmnipolymathPluginServiceV2 = Omit<
  OmnipolymathPluginService,
  "apiVersion" | "start" | "stop"
> & {
  apiVersion: 2;
  start: (ctx: OmnipolymathPluginServiceContextV2) => void | Promise<void>;
  stop?: (ctx: OmnipolymathPluginServiceContextV2) => void | Promise<void>;
};

export type OmnipolymathPluginChannelRegistration<
  Plugin extends import("../channels/plugins/types.plugin.js").AnyChannelPlugin =
    import("../channels/plugins/types.plugin.js").ChannelPlugin,
> = {
  plugin: Plugin;
};

/**
 * Public label exposed to plugin `register(api)` calls.
 *
 * Keep this as a compatibility signal for plugin authors. Loader internals
 * should derive explicit capability booleans from the mode instead of branching
 * on raw strings throughout the code path.
 *
 * - `full`: live runtime activation; long-lived side effects may start.
 * - `discovery`: read-only capability discovery; skip sockets/workers/clients.
 * - `tool-discovery`: capability discovery for executable tools; skip channel runtime hydration.
 * - `setup-only`: lightweight channel setup entry only.
 * - `setup-runtime`: setup flow that also needs the runtime channel entry.
 * - `cli-metadata`: CLI command metadata collection.
 */
export type PluginRegistrationMode =
  | "full"
  | "discovery"
  | "tool-discovery"
  | "setup-only"
  | "setup-runtime"
  | "cli-metadata";

export type {
  PluginServiceSessionWorkV1,
  PluginServiceSessionWorkContextV1,
} from "./service-session-work.types.js";

export type OmnipolymathPluginServiceContextV3 = OmnipolymathPluginServiceContextV2 & {
  sessionWork: import("./service-session-work.types.js").PluginServiceSessionWorkV1;
};

/** A service with host-owned durable session-work admission and current reauthorization. */
export type OmnipolymathPluginServiceV3 = Omit<
  OmnipolymathPluginService,
  "apiVersion" | "start" | "stop"
> & {
  apiVersion: 3;
  start: (ctx: OmnipolymathPluginServiceContextV3) => void | Promise<void>;
  stop?: (ctx: OmnipolymathPluginServiceContextV3) => void | Promise<void>;
};
