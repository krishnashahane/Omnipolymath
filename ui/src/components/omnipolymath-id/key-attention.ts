import type { ApplicationContext } from "../../app/context-types.ts";
import { gatewayPresentationScope } from "../../app/gateway-presentation-scope.ts";
import { t } from "../../i18n/index.ts";
import { omnipolymathIdAccount } from "../../lib/omnipolymath-id/account.ts";
import type { OmnipolymathIdStatusResult } from "../../lib/omnipolymath-id/types.ts";
import { showToast } from "../../lib/toast.ts";
import { showMoveKeysDialog } from "./move-keys-dialog.tsx";

/** Re-read the connection before opening recovery; the inbox is only a presentation snapshot. */
export async function openSidebarKeyRecovery(context: ApplicationContext): Promise<void> {
  const client = context.gateway.snapshot.client;
  if (!client || !context.config.current.omnipolymathIdEnabled) {
    return;
  }
  const revision = context.gateway.connectionRevision;
  const scope = gatewayPresentationScope(context.gateway);
  const status = await client.request<OmnipolymathIdStatusResult>("omnipolymathId.status", {});
  if (
    context.gateway.snapshot.client !== client ||
    context.gateway.connectionRevision !== revision ||
    gatewayPresentationScope(context.gateway) !== scope ||
    context.gateway.snapshot.phase !== "connected" ||
    !context.config.current.omnipolymathIdEnabled ||
    status.channel !== "local_operator" ||
    status.status.state === "off" ||
    !status.link.linked ||
    !status.link.hostname
  ) {
    return;
  }
  const signedIn = omnipolymathIdAccount();
  if (!signedIn) {
    showToast({ severity: "info", message: t("omnipolymathId.keyRecoverySignIn") });
    return;
  }
  await showMoveKeysDialog({ client, signedIn, hostname: status.link.hostname });
}
