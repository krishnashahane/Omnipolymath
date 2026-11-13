import type { GatewayBrowserClient } from "../api/gateway.ts";
import { t } from "../i18n/index.ts";
import { registerOmnipolymathIdEnglish } from "../i18n/locales/en-omnipolymath-id.ts";
import type {
  OmnipolymathIdPeopleLink,
  OmnipolymathIdPublication,
  OmnipolymathIdStatusResult,
} from "../lib/omnipolymath-id/types.ts";
import type { SidebarAttentionItem } from "./sidebar-attention-entries.ts";

registerOmnipolymathIdEnglish();

function buildOmnipolymathIdKeyAttention(
  status: OmnipolymathIdStatusResult,
  publication?: OmnipolymathIdPublication | null,
): SidebarAttentionItem | null {
  if (status.channel !== "local_operator" || !status.link.linked || status.status.state === "off") {
    return null;
  }
  const refused = status.status.state === "keys_refused";
  if (!refused && !(publication?.state === "failed" && publication.code === "binding_superseded")) {
    return null;
  }
  return {
    type: "attention",
    category: "system",
    kind: "omnipolymathIdKeys",
    severity: "error",
    icon: "key",
    requiresAction: true,
    dismissal: null,
    signature: JSON.stringify([
      status.link.clawId,
      refused ? status.status.reason : "binding_superseded",
    ]),
    label: t(
      refused
        ? status.status.reason === "key_mismatch"
          ? "omnipolymathId.keysMismatch"
          : "omnipolymathId.keysMissing"
        : "omnipolymathId.bindingSuperseded",
    ),
    detail: t(refused ? "omnipolymathId.keysRefusedDetail" : "omnipolymathId.bindingSupersededDetail"),
    action: { kind: "omnipolymathIdRecovery", label: t("omnipolymathId.moveToNewKeys") },
  };
}

export async function readOmnipolymathIdKeyAttention(
  client: GatewayBrowserClient,
  current: () => boolean,
): Promise<SidebarAttentionItem | null> {
  const status = await client.request<OmnipolymathIdStatusResult>("omnipolymathId.status", {});
  if (!current()) {
    return null;
  }
  const publication =
    status.status.state !== "keys_refused" &&
    status.channel === "local_operator" &&
    status.owner &&
    status.link.linked
      ? (await client.request<{ link: OmnipolymathIdPeopleLink }>("omnipolymathId.people", {})).link
          .publication
      : null;
  return buildOmnipolymathIdKeyAttention(status, publication);
}
