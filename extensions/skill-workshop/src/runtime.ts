import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import { createPluginRuntimeStore, type PluginRuntime } from "omnipolymath/plugin-sdk/runtime-store";

// The live plugin runtime, set by register(api). Modules read config and host facades here so
// callers outside a single call path (scheduler timers, services) see the current snapshot.
const store = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "skill-workshop",
  errorMessage: "Skill Workshop runtime is not initialized.",
});

export const setWorkshopRuntime = store.setRuntime;
export const getWorkshopRuntime = store.getRuntime;

/** The current runtime config; the operator may change Workshop settings mid-run. */
export function readWorkshopRuntimeConfig(): OmnipolymathConfig {
  // SAFETY: Workshop only reads this snapshot.
  return getWorkshopRuntime().config.current() as OmnipolymathConfig;
}

type WorkshopLogger = {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
};

const noop = () => {};

/** Plugin logger; silent before register(api) so pure helpers stay usable in isolation. */
export function workshopLog(): WorkshopLogger {
  const runtime = store.tryGetRuntime();
  if (!runtime) {
    return { debug: noop, info: noop, warn: noop };
  }
  const logger = runtime.logging.getChildLogger({ plugin: "skill-workshop" });
  return {
    debug: (message) => logger.debug?.(message),
    info: (message) => logger.info(message),
    warn: (message) => logger.warn(message),
  };
}
