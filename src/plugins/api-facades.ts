import { bindPluginCliProgram } from "./cli-callback-binding.js";
import { pluginInstanceState, type PluginInstanceHandle } from "./plugin-instance-scope.js";
import type { OmnipolymathPluginCliRegistrar } from "./plugin-registration.types.js";
import type { OmnipolymathPluginApi } from "./types.js";

type PluginApiFacadeFields = Pick<
  OmnipolymathPluginApi,
  "agent" | "lifecycle" | "runContext" | "session"
>;
type PluginApiFacadeSource = OmnipolymathPluginApi["session"]["state"] &
  OmnipolymathPluginApi["session"]["workflow"] &
  OmnipolymathPluginApi["session"]["controls"] &
  OmnipolymathPluginApi["agent"]["events"] &
  Pick<OmnipolymathPluginApi["agent"], "registerSubagentProfile"> &
  OmnipolymathPluginApi["runContext"] &
  Pick<OmnipolymathPluginApi["lifecycle"], "registerRuntimeLifecycle">;

/** Host implementations used to construct the public API and its namespaces. */
export type OmnipolymathPluginApiWithoutFacades = Omit<OmnipolymathPluginApi, keyof PluginApiFacadeFields> &
  PluginApiFacadeSource;

const identitySensitiveRegistrations = new Set([
  "registerCompactionProvider",
  "registerDecisionProvider",
  "registerGatewayAccessPolicy",
  "registerRepositoryIntegration",
  "registerHttpRoute",
  "registerImageGenerationProvider",
  "registerMediaUnderstandingProvider",
  "registerMigrationProvider",
  "registerMusicGenerationProvider",
  "registerRealtimeTranscriptionProvider",
  "registerRealtimeVoiceProvider",
  "registerSpeechProvider",
  "registerTranscriptSourceProvider",
  "registerVideoGenerationProvider",
  "registerWebFetchProvider",
  "registerWebSearchProvider",
]);

/** Construct public namespaces without exposing retired flat aliases. */
export function attachPluginApiFacades(api: OmnipolymathPluginApiWithoutFacades): OmnipolymathPluginApi {
  const {
    emitAgentEvent,
    registerSubagentProfile,
    setRunContext,
    getRunContext,
    clearRunContext,
    registerSessionAction,
    sendSessionAttachment,
    scheduleSessionTurn,
    unscheduleSessionTurnsByTag,
    steerActiveRun,
    ...retained
  } = api;
  return {
    ...retained,
    session: {
      state: { registerSessionExtension: api.registerSessionExtension },
      workflow: {
        enqueueNextTurnInjection: api.enqueueNextTurnInjection,
        steerActiveRun,
        registerSessionSchedulerJob: api.registerSessionSchedulerJob,
        sendSessionAttachment,
        scheduleSessionTurn,
        unscheduleSessionTurnsByTag,
      },
      controls: {
        registerSessionAction,
        registerControlUiDescriptor: api.registerControlUiDescriptor,
      },
    },
    agent: {
      ...(registerSubagentProfile ? { registerSubagentProfile } : {}),
      events: {
        registerAgentEventSubscription: api.registerAgentEventSubscription,
        emitAgentEvent,
      },
    },
    runContext: { setRunContext, getRunContext, clearRunContext },
    lifecycle: { registerRuntimeLifecycle: api.registerRuntimeLifecycle },
  };
}

/** Apply registration ownership and closure guards to each public method namespace. */
export function proxyPluginApiMethods(
  api: OmnipolymathPluginApi,
  handler: Pick<ProxyHandler<object>, "get">,
): OmnipolymathPluginApi {
  const proxy = <T extends object>(target: T): T => new Proxy<T>(target, handler);
  return proxy({
    ...api,
    session: {
      state: proxy(api.session.state),
      workflow: proxy(api.session.workflow),
      controls: proxy(api.session.controls),
    },
    agent: proxy({ ...api.agent, events: proxy(api.agent.events) }),
    runContext: proxy(api.runContext),
    lifecycle: {
      ...api.lifecycle,
      registerRuntimeLifecycle: proxy(api.lifecycle).registerRuntimeLifecycle,
    },
  });
}

/** Registration callbacks and their API retain the exact admitted instance. */
export function instrumentPluginInstanceApi(
  api: OmnipolymathPluginApi,
  instance?: PluginInstanceHandle,
): OmnipolymathPluginApi {
  if (!instance) {
    return api;
  }
  api.lifecycle = { ...api.lifecycle, ...instance.lifecycle };
  const instrumented = proxyPluginApiMethods(api, {
    get: (target, key, receiver) => {
      const value = Reflect.get(target, key, receiver);
      if (
        typeof value !== "function" ||
        typeof key !== "string" ||
        (!key.startsWith("register") && key !== "on" && key !== "onConversationBindingResolved")
      ) {
        return value;
      }
      if (key === "registerCli" || key === "registerNodeCliFeature") {
        return (registrar: OmnipolymathPluginCliRegistrar, ...options: unknown[]) =>
          instance.run(() =>
            Reflect.apply(value, target, [
              instance.wrap(async (context: Parameters<OmnipolymathPluginCliRegistrar>[0]) => {
                const [{ withPluginCliServiceScheduler }, { toPluginCommandFailure }] =
                  await Promise.all([
                    import("./cli-service-scheduler.js"),
                    import("../cli/failure-output.js"),
                  ]);
                // Commander retains callbacks beyond this registrar's invocation.
                // Bind at the typed host boundary, without proxying its native objects.
                return withPluginCliServiceScheduler(instance, () => {
                  bindPluginCliProgram(context.program, toPluginCommandFailure);
                  return registrar(context);
                });
              }),
              ...options.map((option) => instance.wrap(option)),
            ]),
          );
      }
      return (...args: unknown[]) =>
        instance.run(() =>
          Reflect.apply(
            value,
            target,
            // The tool registrar binds its inspected factory and executable results once.
            key === "registerTool"
              ? args
              : args.map((arg) =>
                  identitySensitiveRegistrations.has(key)
                    ? instance.adopt(arg)
                    : instance.wrap(arg),
                ),
          ),
        );
    },
  });
  pluginInstanceState.values.setHost(instrumented, instance);
  return instrumented;
}
