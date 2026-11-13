import { onSettled } from "solid-js";
import { startOmnipolymathIdFeatureLifetime } from "../../lib/omnipolymath-id/feature-lifetime.ts";
import { bindOwnerApprovalNotifications } from "../../lib/omnipolymath-id/owner-approval-notifications.ts";
import { useApplication } from "../../lib/reactive/context.ts";

/** Owns the enabled feature's mounted lifetime: approval notifications and open dialogs end with it. */
export function OmnipolymathIdNotifications() {
  const context = useApplication();
  onSettled(() => {
    const end = startOmnipolymathIdFeatureLifetime();
    const unbind = bindOwnerApprovalNotifications(context.gateway);
    return () => {
      unbind();
      end();
    };
  });
  return null;
}
