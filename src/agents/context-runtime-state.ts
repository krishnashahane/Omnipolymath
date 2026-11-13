/**
 * Process-global context-window runtime state.
 * Keeps discovery loads and token cache reset behavior
 * shared across module reloads and runtime seams.
 */
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";

const CONTEXT_WINDOW_RUNTIME_STATE_KEY = Symbol.for("omnipolymath.contextWindowRuntimeState");

const globalState = globalThis as typeof globalThis & {
  [CONTEXT_WINDOW_RUNTIME_STATE_KEY]?: {
    loadPromise: Promise<void> | null;
    configuredConfig: OmnipolymathConfig | undefined;
  };
};

/** Shared mutable state for context-window resolution and model discovery. */
export const CONTEXT_WINDOW_RUNTIME_STATE = (globalState[CONTEXT_WINDOW_RUNTIME_STATE_KEY] ||= {
  loadPromise: null,
  configuredConfig: undefined,
});

/** Invalidate prepared context metadata while a replacement load is staged. */
export function beginContextWindowCacheRefresh(): void {
  CONTEXT_WINDOW_RUNTIME_STATE.loadPromise = null;
  CONTEXT_WINDOW_RUNTIME_STATE.configuredConfig = undefined;
}
