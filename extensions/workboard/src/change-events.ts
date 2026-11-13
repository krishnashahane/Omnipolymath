import type { WorkboardChange } from "@omnipolymath/workboard-contract";
import type { OmnipolymathPluginService } from "../api.js";
import type { WorkboardStore } from "./store.js";

export function createWorkboardChangeEventService(
  store: Pick<WorkboardStore, "ready" | "onChange" | "announceChangeEpoch">,
): OmnipolymathPluginService & { stop: () => Promise<void> } {
  return {
    id: "workboard-change-events",
    async start(ctx) {
      const gatewayEvents = ctx.gatewayEvents;
      if (!gatewayEvents || store.onChange) {
        return;
      }
      await store.ready();
      store.onChange = (change: WorkboardChange) => {
        gatewayEvents.emit("changed", change, {
          scope: "operator.read",
        });
      };
      store.announceChangeEpoch();
    },
    async stop() {
      store.onChange = undefined;
    },
  };
}
