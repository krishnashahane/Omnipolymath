import { isPromiseLike } from "@omnipolymath/normalization-core/promise-like";
import { proxyPluginApiMethods, type OmnipolymathPluginApiWithoutFacades } from "./api-facades.js";
import { pluginInstanceInvocation } from "./plugin-instance-invocation.js";
import { getPluginValueInstance } from "./plugin-instance-scope.js";
import type { OmnipolymathPluginApi, OmnipolymathPluginDefinition } from "./types.js";

const LATE_CALLABLE_PLUGIN_API_METHODS: ReadonlySet<string> = new Set<
  keyof OmnipolymathPluginApiWithoutFacades
>([
  "clearRunContext",
  "emitAgentEvent",
  "enqueueNextTurnInjection",
  "steerActiveRun",
  "getRunContext",
  // Registered callbacks still need these pure utilities after register() returns.
  "inlineView",
  "resolvePath",
  "sendSessionAttachment",
  "scheduleSessionTurn",
  "setRunContext",
  "unscheduleSessionTurnsByTag",
]);

function createGuardedPluginRegistrationApi(api: OmnipolymathPluginApi): {
  api: OmnipolymathPluginApi;
  close: () => void;
} {
  let closed = false;
  const owner = getPluginValueInstance(api);
  const guardedApi = proxyPluginApiMethods(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      if (typeof prop === "string" && LATE_CALLABLE_PLUGIN_API_METHODS.has(prop)) {
        return (...args: unknown[]) => Reflect.apply(value, target, args);
      }
      return (...args: unknown[]) => {
        // A retained module may now hold another generation's API.
        const caller = pluginInstanceInvocation.getStore()?.instance;
        if (caller && owner && caller !== owner) {
          throw new Error(
            `Plugin ${owner.pluginId} API registration does not belong to the calling workspace generation`,
          );
        }
        if (closed) {
          return undefined;
        }
        return Reflect.apply(value, target, args);
      };
    },
  });
  return {
    api: guardedApi,
    close: () => {
      closed = true;
    },
  };
}

export function runPluginRegistration(
  register: NonNullable<OmnipolymathPluginDefinition["register"]>,
  api: Parameters<NonNullable<OmnipolymathPluginDefinition["register"]>>[0],
  asyncResult: "reject" | "ignore" = "reject",
  trackPending?: (pending: Promise<unknown>) => void,
): void {
  const guarded = createGuardedPluginRegistrationApi(api);
  try {
    const result = register(guarded.api);
    if (isPromiseLike(result)) {
      const pending = Promise.resolve(result);
      trackPending?.(pending);
      void pending.catch(() => {});
      if (asyncResult === "reject") {
        throw new Error("plugin register must be synchronous");
      }
    }
  } finally {
    guarded.close();
  }
}
