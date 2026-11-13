import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";

export type GatewayRunRuntimeHooks = {
  /** Exact Gateway cleanup disposition; absent when startup never reached its owner. */
  onProcessResourcesSettled?: (outcome: "drained" | "retained") => void;
  releaseManagedProxy?: () => Promise<void> | void;
  refreshManagedProxy?: (config: OmnipolymathConfig["proxy"]) => Promise<void> | void;
};

let activeGatewayRunRuntimeHooks: GatewayRunRuntimeHooks = {};

export function getGatewayRunRuntimeHooks(): GatewayRunRuntimeHooks {
  return activeGatewayRunRuntimeHooks;
}

export function installGatewayRunRuntimeHooks(hooks: GatewayRunRuntimeHooks): () => void {
  const previous = activeGatewayRunRuntimeHooks;
  activeGatewayRunRuntimeHooks = hooks;
  return () => {
    if (activeGatewayRunRuntimeHooks === hooks) {
      activeGatewayRunRuntimeHooks = previous;
    }
  };
}
