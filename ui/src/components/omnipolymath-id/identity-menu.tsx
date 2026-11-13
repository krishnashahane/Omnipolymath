import { createMemo, createSignal, onSettled, refresh } from "solid-js";
import type { GatewayEventListener } from "../../api/gateway.ts";
import type {
  OmnipolymathIdPeopleLink,
  OmnipolymathIdPublication,
  OmnipolymathIdStatusResult,
} from "../../lib/omnipolymath-id/types.ts";
import { projectGateway } from "../../lib/reactive/application.ts";
import { useApplication } from "../../lib/reactive/context.ts";
import { createTimeout } from "../../lib/reactive/timers.ts";
import {
  renderSidebarIdentityMenu as SidebarIdentityMenu,
  type SidebarIdentityMenuParams,
} from "../app-sidebar-identity-menu.tsx";
import {
  omnipolymathIdMenuEntries,
  omnipolymathIdMenuIdentity,
  omnipolymathIdSignOutEntries,
  selectOmnipolymathIdMenuValue,
} from "./account-menu.tsx";

/** The enabled-only account adapter; off renders the ordinary menu without this module. */
export function OmnipolymathIdIdentityMenu(props: SidebarIdentityMenuParams) {
  const context = useApplication();
  const gateway = projectGateway(context.gateway);
  const connection = createMemo(
    () => {
      const { snapshot, connectionRevision } = gateway.read();
      return snapshot.phase === "connected" && snapshot.client
        ? { client: snapshot.client, revision: connectionRevision }
        : null;
    },
    { equals: (a, b) => a?.client === b?.client && a?.revision === b?.revision },
  );
  const status = createMemo(
    async () =>
      connection()
        ?.client.request<OmnipolymathIdStatusResult>("omnipolymathId.status", {})
        .catch(() => null) ?? null,
    { loadingValue: null },
  );
  // A failed reread retains this owner's warning; retiring its scope disposes that projection.
  const publication = createMemo(() => {
    const owner = connection();
    const current = status();
    if (!owner || current?.channel !== "local_operator" || !current.owner || !current.link.linked) {
      return null;
    }
    const read = createMemo<OmnipolymathIdPublication | null>(
      (previous) =>
        owner.client
          .request<{ link: OmnipolymathIdPeopleLink }>("omnipolymathId.people", {})
          .then(({ link }) => link.publication ?? null)
          .catch(() => previous),
      { loadingValue: null },
    );
    const onGatewayEvent: GatewayEventListener = (event) => {
      if (event.event === "omnipolymathId.people.changed") {
        void refresh(read);
      }
    };
    onSettled(() => context.gateway.subscribeEvents(onGatewayEvent));
    return read;
  });
  const [copied, setCopied] = createSignal(false);
  const resetCopied = createTimeout(() => setCopied(false), 2200);
  const extension = createMemo(() => {
    const current = status();
    if (!current || current.status.state === "off") {
      return undefined;
    }
    return {
      identity: omnipolymathIdMenuIdentity(current),
      entries: omnipolymathIdMenuEntries(current, publication()?.(), copied),
      signOut: omnipolymathIdSignOutEntries(current),
      onSelect: (value: string) =>
        selectOmnipolymathIdMenuValue(value, {
          status: status(),
          client: context.gateway.snapshot.client,
          basePath: props.basePath,
          onLinkCopied: () => {
            setCopied(true);
            resetCopied.schedule();
          },
          onKeysChanged: () => context.sidebarAttention.refreshOmnipolymathId(),
        }),
    };
  });
  return <SidebarIdentityMenu {...props} extension={extension()} />;
}
