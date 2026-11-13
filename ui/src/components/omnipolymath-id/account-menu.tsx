// Connection-aware Omnipolymath ID account menu. Gateway-verified identity owns the
// header; local browser sign-in controls only the loopback onboarding actions.
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { registerOmnipolymathIdEnglish } from "../../i18n/locales/en-omnipolymath-id.ts";
import { copyToClipboard } from "../../lib/clipboard.ts";
import {
  omnipolymathIdAccount,
  signInWithOmnipolymathId,
  signOutOfOmnipolymathId,
} from "../../lib/omnipolymath-id/account.ts";
import { signOutOfRemoteOmnipolymathId } from "../../lib/omnipolymath-id/remote-sign-out.ts";
import type {
  OmnipolymathIdPublication,
  OmnipolymathIdSignedIn,
  OmnipolymathIdStatusResult,
} from "../../lib/omnipolymath-id/types.ts";
import {
  omnipolymathIdErrorToast,
  type OmnipolymathIdErrorContext,
} from "../../lib/omnipolymath-id/ui-error.ts";
import { registerEnglishCatalog, t } from "../../lib/reactive/i18n.ts";
import { showToast } from "../../lib/toast.ts";
import { renderSidebarMenuAction } from "../app-sidebar-dropdown.tsx";
import { showConfirmDialog } from "../confirm-dialog.ts";
import { Icon, type IconName } from "../solid/icon.tsx";
import type { MenuEntry } from "../solid/menu.tsx";
import { StrokeIcon } from "../solid/stroke-icon.tsx";
import { clawNameFromHostname } from "./claw-name.ts";

registerEnglishCatalog(registerOmnipolymathIdEnglish);
const VALUE_PREFIX = "omnipolymath-id:";
const SIGN_IN = `${VALUE_PREFIX}sign-in`;
const MAKE_REACHABLE = `${VALUE_PREFIX}make-reachable`;
const DEVICES = `${VALUE_PREFIX}devices`;
const SIGN_OUT = `${VALUE_PREFIX}sign-out`;
const COPY_LINK = `${VALUE_PREFIX}copy-link`;
const MOVE_KEYS = `${VALUE_PREFIX}move-keys`;
const PUBLISH_KEYS = `${VALUE_PREFIX}publish-keys`;

/** Derives the compact account header without ever displaying an account ID. */
export function omnipolymathIdMenuIdentity(status: OmnipolymathIdStatusResult) {
  const identity = status.connection;
  if (status.channel === "tunnel") {
    if (identity?.kind === "member") {
      const role = t(
        identity.role === "viewer" ? "omnipolymathId.roleViewer" : "omnipolymathId.roleOperator",
      );
      return {
        name: identity.email || t("omnipolymathId.accountFallback"),
        detail: t("omnipolymathId.memberRoleOnClaw", {
          role,
          claw: status.link.hostname
            ? clawNameFromHostname(status.link.hostname)
            : t("omnipolymathId.thisClaw"),
        }),
      };
    }
    if (identity?.kind !== "owner") {
      return { name: t("omnipolymathId.accountFallback"), detail: t("omnipolymathId.encryptedConnection") };
    }
    const email = identity.accountEmail;
    const name = identity.accountName;
    return {
      name: name || email || t("omnipolymathId.accountFallback"),
      detail: email ? `${email} · ${t("omnipolymathId.ownerRole")}` : t("omnipolymathId.ownerRole"),
    };
  }
  if (omnipolymathIdAccount()) {
    // Browser storage never supplies the displayed profile; only this RPC does.
    const email = identity?.kind === "local" ? identity.accountEmail : null;
    const name = identity?.kind === "local" ? identity.accountName : null;
    return {
      name: name || email || t("omnipolymathId.accountFallback"),
      detail: email ? `${email} · ${t("omnipolymathId.localOperator")}` : t("omnipolymathId.localOperator"),
    };
  }
  return { name: t("omnipolymathId.localOperator"), detail: t("omnipolymathId.thisComputer") };
}

// One noninteractive status row, aligned with the sidebar's existing icon column.
function statusRow(
  id: string,
  label: string,
  icon: IconName,
  detail?: string | null,
  online?: boolean,
  attention?: boolean,
): MenuEntry {
  return {
    kind: "content",
    id: `omnipolymath-id-${id}`,
    content: (
      <div
        class="sidebar-omnipolymath-id__status"
        data-attention={attention ? "true" : undefined}
        role={attention ? "status" : undefined}
      >
        <span
          class="nav-item__icon"
          aria-hidden="true"
          style={{ color: attention ? "var(--warn)" : undefined }}
        >
          <Icon name={icon} />
        </span>
        <span class="sidebar-omnipolymath-id__lines">
          <span>{label}</span>
          {detail ? <span class="sidebar-omnipolymath-id__detail">{detail}</span> : undefined}
        </span>
        {online !== undefined ? (
          <span class="sidebar-omnipolymath-id__pill" data-online={online ? "true" : "false"}>
            {t(online ? "omnipolymathId.online" : "omnipolymathId.offline")}
          </span>
        ) : undefined}
      </div>
    ),
  };
}

// Make reachable is offered only after loopback sign-in.
function makeReachableBlocker(status: OmnipolymathIdStatusResult): string | undefined {
  if (status.channel !== "local_operator") {
    return t("omnipolymathId.makeReachableLocalOnly");
  }
  return status.services.loaderDomain ? undefined : t("omnipolymathId.needsLoaderDomain");
}

// Keys this computer cannot use, or newer published keys, each with its fix (local only).
function keyAttentionEntries(
  status: OmnipolymathIdStatusResult,
  publication: OmnipolymathIdPublication | null | undefined,
): MenuEntry[] {
  const failed = publication?.state === "failed" ? publication.code : undefined;
  const refused = status.status.state === "keys_refused";
  const warning = refused
    ? "keys-refused"
    : failed === "binding_superseded"
      ? "binding-superseded"
      : failed === "needs_link_code"
        ? "needs-link-code"
        : null;
  if (!warning) {
    return [];
  }
  const label = refused
    ? status.status.reason === "key_mismatch"
      ? "keysMismatch"
      : "keysMissing"
    : failed === "binding_superseded"
      ? "bindingSuperseded"
      : "needsLinkCode";
  const detail = refused ? "keysRefusedDetail" : `${label}Detail`;
  const entries = [
    statusRow(
      warning,
      t(`omnipolymathId.${label}`),
      "alertTriangle",
      t(`omnipolymathId.${detail}`),
      undefined,
      true,
    ),
  ];
  if (warning === "needs-link-code") {
    entries.push(renderSidebarMenuAction(PUBLISH_KEYS, t("omnipolymathId.publishNewKeys"), "radio"));
  }
  return entries;
}

/**
 * One claw card, followed by its account actions. `publication`
 * is the owner-only publication state (`omnipolymathId.people`), read on this computer.
 */
export function omnipolymathIdMenuEntries(
  status: OmnipolymathIdStatusResult | null,
  publication?: OmnipolymathIdPublication | null,
  copied: () => boolean = () => false,
): MenuEntry[] {
  if (!status || status.status.state === "off") {
    return [];
  }
  if (status.channel !== "tunnel" && !omnipolymathIdAccount()) {
    const blocker =
      status.channel !== "local_operator"
        ? t("omnipolymathId.signInLocalOnly")
        : !status.services.clientId
          ? t("omnipolymathId.signInUnconfigured")
          : undefined;
    return [
      {
        id: SIGN_IN,
        label: t("omnipolymathId.signIn"),
        disabled: Boolean(blocker),
        // Preserve menu-owned selection and keyboard registration, with native button semantics.
        render: (attributes) => (
          <button
            {...attributes}
            type="button"
            role="button"
            class="oc-menu-item sidebar-omnipolymath-id__card sidebar-omnipolymath-id__status sidebar-omnipolymath-id__sign-in"
            aria-description={blocker}
            disabled={attributes["aria-disabled"] === "true"}
          >
            <span class="nav-item__icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m10 17 5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              </svg>
            </span>
            <span class="sidebar-omnipolymath-id__lines">
              <span>{t("omnipolymathId.signIn")}</span>
              {blocker ? <span class="sidebar-omnipolymath-id__detail">{blocker}</span> : undefined}
            </span>
            {!blocker ? (
              <span class="oc-menu-item__details">
                <Icon name="arrowRight" />
              </span>
            ) : undefined}
          </button>
        ),
      },
    ];
  }
  const card: MenuEntry[] = [];
  if (status.channel === "tunnel") {
    const connection = status.connection;
    const detail =
      connection?.kind === "owner"
        ? t("omnipolymathId.thisDevice", {
            label: connection.deviceLabel || t("omnipolymathId.unnamedDevice"),
          })
        : connection?.kind === "member" && connection.invitedBy
          ? t("omnipolymathId.invitedBy", {
              owner:
                connection.invitedBy.name ||
                connection.invitedBy.email ||
                t("omnipolymathId.accountFallback"),
            })
          : null;
    card.push(statusRow("encrypted", t("omnipolymathId.encryptedConnection"), "lock", detail));
  } else if (status.link.linked && status.link.hostname && omnipolymathIdAccount()) {
    const local = status.channel === "local_operator";
    if (local && status.status.state !== "keys_refused") {
      card.push({
        id: COPY_LINK,
        label: t("omnipolymathId.copyRemoteLink"),
        closeOnSelect: false,
        class: "sidebar-omnipolymath-id__card sidebar-omnipolymath-id__linked",
        attributes: {
          "aria-description": status.link.hostname,
          get "data-copied"() {
            return copied() ? "true" : undefined;
          },
        },
        content: (
          <span class="sidebar-omnipolymath-id__linked-content">
            <span class="nav-item__icon" aria-hidden="true">
              <Icon name="radio" />
            </span>
            <span class="sidebar-omnipolymath-id__label">{t("omnipolymathId.remoteAccessOn")}</span>
            <span class="sidebar-omnipolymath-id__trailing">
              <span
                class="sidebar-omnipolymath-id__pill"
                data-online={status.status.tunnel?.relayOnline === true ? "true" : "false"}
              >
                {t(
                  status.status.tunnel?.relayOnline === true
                    ? "omnipolymathId.online"
                    : "omnipolymathId.offline",
                )}
              </span>
              <span class="sidebar-omnipolymath-id__copy" aria-hidden="true">
                <span class="sidebar-omnipolymath-id__copy-a">
                  <Icon name="copy" />
                </span>
                <span class="sidebar-omnipolymath-id__copy-b">
                  <Icon name="check" />
                </span>
              </span>
            </span>
            <span class="sidebar-omnipolymath-id__detail">{status.link.hostname}</span>
          </span>
        ),
      });
    } else {
      if (status.status.state !== "keys_refused") {
        card.push(
          statusRow(
            "reachable",
            t("omnipolymathId.remoteAccessOn"),
            "radio",
            status.link.hostname,
            status.status.tunnel?.relayOnline === true,
          ),
        );
      }
      if (local) {
        card.push(renderSidebarMenuAction(COPY_LINK, t("omnipolymathId.copyRemoteLink"), "link"));
      }
    }
  } else {
    const blocker = makeReachableBlocker(status);
    card.push(
      renderSidebarMenuAction(MAKE_REACHABLE, t("omnipolymathId.makeReachable"), "radio", {
        disabled: Boolean(blocker),
        title: blocker,
        details: <Icon name="arrowRight" />,
      }),
    );
  }
  const entries: MenuEntry[] = [
    {
      kind: "group",
      id: "omnipolymath-id-card",
      class:
        status.channel === "local_operator" &&
        status.link.linked &&
        status.status.state !== "keys_refused"
          ? undefined
          : "sidebar-omnipolymath-id__card",
      items: card,
    },
  ];
  if (status.channel === "local_operator" && status.link.linked && omnipolymathIdAccount()) {
    entries.push(...keyAttentionEntries(status, publication));
    entries.push(renderSidebarMenuAction(MOVE_KEYS, t("omnipolymathId.moveToNewKeys"), "key"));
  }
  if (status.owner && status.link.linked && (status.channel === "tunnel" || omnipolymathIdAccount())) {
    entries.push(renderSidebarMenuAction(DEVICES, t("omnipolymathId.yourDevices"), "monitor"));
  }
  return entries;
}

/** Sign-out is the final account action; remote sessions use the loader's actual mechanism. */
export function omnipolymathIdSignOutEntries(status: OmnipolymathIdStatusResult | null): MenuEntry[] {
  if (!status || status.status.state === "off") {
    return [];
  }
  const available =
    status.channel === "tunnel"
      ? Boolean(navigator.serviceWorker?.controller)
      : status.channel === "local_operator" && Boolean(omnipolymathIdAccount());
  return available
    ? [
        {
          id: SIGN_OUT,
          label: t("omnipolymathId.signOut"),
          class: "sidebar-customize-menu__item",
          icon: (
            <span class="nav-item__icon" aria-hidden="true">
              <StrokeIcon>
                <path d="m16 17 5-5-5-5M21 12H9M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              </StrokeIcon>
            </span>
          ),
          content: <span class="sidebar-customize-menu__text">{t("omnipolymathId.signOut")}</span>,
        },
      ]
    : [];
}

// Runs a lazily loaded dialog; a failed load or dialog error shows one toast.
function openDialog(open: () => Promise<unknown>, context: OmnipolymathIdErrorContext = "open") {
  open().catch((error: unknown) =>
    showToast({
      severity: "error",
      message: omnipolymathIdErrorToast(error, context),
      durationMs: 12_000,
    }),
  );
}

// Opens Make reachable, with the link code taken from the account when signed in.
function startMakeReachable(client: GatewayBrowserClient, loaderDomain: string) {
  openDialog(async () =>
    (await import("./make-reachable-dialog.tsx")).showMakeReachableDialog({
      client,
      loaderDomain,
      signedIn: omnipolymathIdAccount(),
    }),
  );
}

// After sign-in on an unlinked claw: offer Make reachable (dismissing is "Not now").
function offerMakeReachable(
  client: GatewayBrowserClient,
  status: OmnipolymathIdStatusResult | null,
  account: string,
) {
  const loaderDomain = status?.services.loaderDomain;
  if (!status || status.link.linked || !loaderDomain || makeReachableBlocker(status)) {
    showToast({ severity: "success", message: t("omnipolymathId.signedIn", { account }) });
    return;
  }
  showToast({
    severity: "info",
    message: t("omnipolymathId.reachOffer", { account }),
    actionLabel: t("omnipolymathId.makeReachable"),
    onAction: () => startMakeReachable(client, loaderDomain),
    durationMs: 30_000,
  });
}

// The browser's sign-in, for actions only the operator on this computer may run.
function localSignedIn(status: OmnipolymathIdStatusResult): OmnipolymathIdSignedIn | null {
  return status.channel === "local_operator" ? omnipolymathIdAccount() : null;
}

/**
 * Runs an Omnipolymath ID menu command. Returns false for values it does not own.
 * Call synchronously from the menu selection so the sign-in popup keeps the
 * click's user activation.
 */
export function selectOmnipolymathIdMenuValue(
  value: string,
  context: {
    status: OmnipolymathIdStatusResult | null;
    client: GatewayBrowserClient | null | undefined;
    basePath: string;
    onKeysChanged?: () => void;
    onLinkCopied?: () => void;
  },
): boolean {
  if (!value.startsWith(VALUE_PREFIX) || !context.status || context.status.status.state === "off") {
    return false;
  }
  const { client, status } = context;
  if (value === DEVICES && client && status?.owner) {
    openDialog(async () =>
      (await import("./owner-devices-dialog.tsx")).showOwnerDevicesDialog({ client }),
    );
  } else if (value === COPY_LINK && status?.channel === "local_operator" && status.link.hostname) {
    void copyToClipboard(`https://${status.link.hostname}`).then((copied) => {
      if (copied) {
        context.onLinkCopied?.();
      }
      showToast({
        severity: copied ? "success" : "error",
        message: t(copied ? "omnipolymathId.remoteLinkCopied" : "omnipolymathId.remoteLinkCopyFailed"),
      });
    });
  } else if (value === SIGN_OUT) {
    if (status?.channel === "tunnel") {
      openDialog(signOutOfRemoteOmnipolymathId, "signOut");
    } else {
      openDialog(async () => {
        const confirmed = await showConfirmDialog({
          title: t("omnipolymathId.signOut"),
          message: t("omnipolymathId.signOutReachability"),
          confirmLabel: t("omnipolymathId.signOut"),
        });
        if (confirmed) {
          signOutOfOmnipolymathId();
        }
      }, "signOut");
    }
  } else if (value === SIGN_IN && client) {
    signInWithOmnipolymathId({ client, basePath: context.basePath }).then(
      (signedIn) =>
        offerMakeReachable(client, status, signedIn.email ?? t("omnipolymathId.accountFallback")),
      (error: unknown) =>
        showToast({
          severity: "error",
          message: omnipolymathIdErrorToast(error, "signIn"),
          durationMs: 12_000,
        }),
    );
  } else if (value === MAKE_REACHABLE && client && status?.services.loaderDomain) {
    startMakeReachable(client, status.services.loaderDomain);
  } else if (value === MOVE_KEYS && client && status.link.hostname) {
    const signedIn = localSignedIn(status);
    const hostname = status.link.hostname;
    if (signedIn) {
      openDialog(async () => {
        if (
          await (
            await import("./move-keys-dialog.tsx")
          ).showMoveKeysDialog({ client, signedIn, hostname })
        ) {
          context.onKeysChanged?.();
        }
      });
    }
  } else if (value === PUBLISH_KEYS && client) {
    const signedIn = localSignedIn(status);
    if (signedIn) {
      openDialog(async () => {
        const { publishWithLinkCode } = await import("../../lib/omnipolymath-id/rebind.ts");
        const { publication } = await publishWithLinkCode(client, signedIn);
        if (publication?.state === "failed") {
          throw Object.assign(new Error("Omnipolymath ID publication failed"), publication);
        }
        context.onKeysChanged?.();
        showToast({ severity: "success", message: t("omnipolymathId.newKeysPublished") });
      }, "linkCode");
    }
  }
  return true;
}
