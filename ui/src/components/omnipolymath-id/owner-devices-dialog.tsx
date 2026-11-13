// "Your devices" from the account menu (OCF-280): the claw's active owner
// devices, who approved each one, which one is this browser, and Revoke for the
// others. Revoking also removes the devices the revoked one approved; the dialog
// names them first. Device keys are per claw, so a removal applies to this claw.
import "./owner-devices-dialog.css";
import { createMemo, createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import {
  displayFingerprint,
  fingerprint,
} from "../../../../packages/omnipolymath-id-protocol/src/index.ts";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { registerOmnipolymathIdDialogsEnglish } from "../../i18n/locales/en-omnipolymath-id-dialogs.ts";
import { registerOmnipolymathIdEnglish } from "../../i18n/locales/en-omnipolymath-id.ts";
import { omnipolymathIdFeatureSignal } from "../../lib/omnipolymath-id/feature-lifetime.ts";
import {
  approverOf,
  devicesApprovedBy,
  signOwnerDeviceRevocation,
  thisOwnerDevice,
} from "../../lib/omnipolymath-id/owner-devices.ts";
import type {
  OmnipolymathIdStatusResult,
  OmnipolymathIdOwnerDevice,
  OmnipolymathIdPeopleLink,
} from "../../lib/omnipolymath-id/types.ts";
import { omnipolymathIdUiError, type OmnipolymathIdUiError } from "../../lib/omnipolymath-id/ui-error.ts";
import { getLocale, registerEnglishCatalog, t } from "../../lib/reactive/i18n.ts";
import { withPromiseModalHost } from "../promise-modal-host.ts";
import { IconButton } from "../solid/icon-button.tsx";
import { Icon } from "../solid/icon.tsx";
import { OmnipolymathIdErrorMessage } from "./error-message.tsx";
import { showOwnerApprovalDialog } from "./owner-approval-dialog.tsx";
import { createOwnerDialogMotion } from "./owner-dialog-motion.ts";

registerEnglishCatalog(registerOmnipolymathIdDialogsEnglish);
registerEnglishCatalog(registerOmnipolymathIdEnglish);

type Link = OmnipolymathIdPeopleLink;

// Reads the owner-only link state (devices change after every revocation).
async function readLink(client: GatewayBrowserClient): Promise<Link> {
  return (await client.request<{ link: Link }>("omnipolymathId.people", {})).link;
}

// The owner key's display fingerprint, as printed on the recovery kit.
async function ownerFingerprint(link: Link): Promise<string | null> {
  try {
    // SAFETY: fingerprint rejects a malformed key, which the catch below turns into null.
    return link.rootPub ? displayFingerprint(await fingerprint(link.rootPub as never)) : null;
  } catch {
    return null;
  }
}

/** One device row with an inline, explained Revoke. */
function DeviceRow(props: {
  device: OmnipolymathIdOwnerDevice;
  isThisBrowser: boolean;
  approver: ReturnType<typeof approverOf>;
  approved: OmnipolymathIdOwnerDevice[];
  canRevoke: boolean;
  busy: boolean;
  confirming: boolean;
  morph: (element: HTMLElement) => void;
  registerElement: (element: HTMLDivElement) => () => void;
  onConfirm: (confirming: boolean) => void;
  onRevoke: () => void;
}) {
  let rowElement: HTMLDivElement | undefined;
  onSettled(() => props.registerElement(rowElement!));
  const explanation = createMemo(() => {
    const message =
      props.approved.length > 0
        ? t("omnipolymathId.revokeCascade", {
            device: props.device.label,
            devices: props.approved.map((device) => device.label).join(", "),
          })
        : t("omnipolymathId.revokeOne", { device: props.device.label });
    // Separate the final recovery sentence without rewriting localized copy or device names.
    const sentences = [
      ...new Intl.Segmenter(getLocale(), { granularity: "sentence" }).segment(message),
    ];
    const recoveryStart = sentences.at(-1)?.index ?? 0;
    return recoveryStart
      ? [message.slice(0, recoveryStart), message.slice(recoveryStart)]
      : [message];
  });
  return (
    <div
      ref={(element) => {
        rowElement = element;
        props.morph(element);
      }}
      role="listitem"
      class={[
        "row omnipolymath-id-devices__row",
        { "omnipolymath-id-devices__row--confirming": props.confirming },
      ]}
    >
      <div class="stack omnipolymath-id-devices__text">
        <strong class="omnipolymath-id-devices__label">
          <span class="omnipolymath-id-devices__name" title={props.device.label}>
            {props.device.label}
          </span>
        </strong>
        <div class="muted omnipolymath-id-devices__hint">
          {props.device.peerKeys.length > 0
            ? t("omnipolymathId.deviceRemote")
            : t("omnipolymathId.deviceLocal")}
          {" · "}
          {props.approver.kind === "kit"
            ? t("omnipolymathId.approvedByKit")
            : props.approver.kind === "device"
              ? t("omnipolymathId.approvedByDevice", { device: props.approver.label })
              : t("omnipolymathId.approvedByRemoved")}
        </div>
      </div>
      <Show when={props.isThisBrowser}>
        <span class="chip">{t("omnipolymathId.thisBrowser")}</span>
      </Show>
      <Show when={props.canRevoke && !props.isThisBrowser}>
        <Show
          when={props.confirming}
          fallback={
            <button
              type="button"
              class="omnipolymath-id-devices__revoke"
              disabled={props.busy}
              onClick={() => props.onConfirm(true)}
            >
              {t("omnipolymathId.revoke")}
            </button>
          }
        >
          <div class="omnipolymath-id-devices__confirmation omnipolymath-id-owner-enter">
            <div role="note">
              <For each={explanation()}>{(sentence) => <p>{sentence}</p>}</For>
            </div>
            <omnipolymath-modal-actions>
              <button
                type="button"
                class="btn btn--sm"
                disabled={props.busy}
                onClick={() => props.onConfirm(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                class="btn btn--sm danger omnipolymath-id-devices__confirm-revoke"
                disabled={props.busy}
                onClick={() => props.onRevoke()}
              >
                {t("omnipolymathId.revokeConfirm", { device: props.device.label })}
              </button>
            </omnipolymath-modal-actions>
          </div>
        </Show>
      </Show>
    </div>
  );
}

/**
 * Shows the claw's owner devices. Only an owner device (a browser holding its
 * key) can revoke; this browser can't revoke itself. Resolves when closed.
 */
export function showOwnerDevicesDialog(params: { client: GatewayBrowserClient }): Promise<void> {
  // Closes when the feature turns off.
  const lifetime = { signal: omnipolymathIdFeatureSignal(), value: undefined };
  return withPromiseModalHost<void>(lifetime, (modal) => {
    modal.render(() => {
      const [link, setLink] = createSignal<Link | null>(null);
      const [ownPub, setOwnPub] = createSignal<string | null>(null);
      const [ownerFp, setOwnerFp] = createSignal<string | null>(null);
      const [localOperator, setLocalOperator] = createSignal(false);
      const [busy, setBusy] = createSignal(false);
      const [confirming, setConfirming] = createSignal<string | null>(null);
      const [securityOpen, setSecurityOpen] = createSignal(false);
      const securityId = createUniqueId();
      const [error, setError] = createSignal<OmnipolymathIdUiError | null>(null);
      const motion = createOwnerDialogMotion();
      const rowElements = new Map<string, HTMLDivElement>();
      let revocationPending = false;
      const refresh = async () => {
        try {
          const [next, status] = await Promise.all([
            readLink(params.client),
            params.client.request<OmnipolymathIdStatusResult>("omnipolymathId.status", {}),
          ]);
          setLocalOperator(status.channel === "local_operator" && next.linked);
          setOwnPub((await thisOwnerDevice(next).catch(() => undefined))?.devicePub ?? null);
          setOwnerFp(await ownerFingerprint(next));
          // Only a fresh Gateway listing can start removal, including cascade removals.
          if (revocationPending && !modal.settled) {
            const remaining = new Set(next.ownerDevices?.map((device) => device.devicePub));
            await motion.collapse(
              [...rowElements].filter(([key]) => !remaining.has(key)).map(([, row]) => row),
            );
          }
          setLink(next);
          if (!next.ownerDevices?.some((device) => device.devicePub === confirming())) {
            setConfirming(null);
          }
        } catch (failure) {
          setError(omnipolymathIdUiError(failure, "devices"));
        }
      };
      const revoke = async (device: OmnipolymathIdOwnerDevice) => {
        const current = link();
        if (!current || revocationPending) {
          return;
        }
        revocationPending = true;
        setBusy(true);
        setError(null);
        try {
          const statement = await signOwnerDeviceRevocation(current, device);
          await params.client.request("omnipolymathId.authority", { action: "submit", statement });
        } catch (failure) {
          setError(omnipolymathIdUiError(failure, "remove"));
        } finally {
          await refresh();
          revocationPending = false;
          setBusy(false);
        }
      };
      onSettled(() => {
        void refresh();
      });
      const devices = createMemo(() => {
        const current = ownPub();
        return (link()?.ownerDevices ?? []).toSorted(
          (a, b) => Number(b.devicePub === current) - Number(a.devicePub === current),
        );
      });
      return (
        <omnipolymath-modal-dialog
          class="omnipolymath-id-owner-dialog omnipolymath-id-owner-dialog--devices"
          label={t("omnipolymathId.yourDevices")}
          description={t("omnipolymathId.yourDevicesBody")}
          onModal-cancel={() => modal.finish(undefined)}
        >
          <div ref={motion.card} class="exec-approval-card omnipolymath-id-devices">
            <h2 class="exec-approval-title omnipolymath-id-devices__title">
              {t("omnipolymathId.yourDevices")}
            </h2>
            <IconButton
              class="omnipolymath-id-devices__close"
              icon="x"
              label={t("common.close")}
              tooltip={false}
              onClick={() => modal.finish(undefined)}
            />
            <p class="omnipolymath-id-devices__description">{t("omnipolymathId.yourDevicesBody")}</p>
            <Show when={error()}>
              {(message) => (
                <div class="omnipolymath-id-devices__error omnipolymath-id-owner-enter" role="alert">
                  <OmnipolymathIdErrorMessage error={message()} />
                </div>
              )}
            </Show>
            <div
              class={[
                "list omnipolymath-id-devices__list",
                { "omnipolymath-id-owner-enter": devices().length > 0 },
              ]}
              role="list"
              tabindex={0}
              aria-label={t("omnipolymathId.yourDevices")}
            >
              <For each={devices()} keyed={(device) => device.devicePub}>
                {(device) => (
                  <DeviceRow
                    device={device()}
                    isThisBrowser={device().devicePub === ownPub()}
                    approver={approverOf(devices(), device())}
                    approved={
                      confirming() === device().devicePub
                        ? devicesApprovedBy(devices(), device())
                        : []
                    }
                    canRevoke={Boolean(ownPub())}
                    busy={busy()}
                    confirming={confirming() === device().devicePub}
                    morph={motion.section}
                    registerElement={(element) => {
                      // The keyed row owns this registration until it unmounts.
                      const initialDevicePub = device().devicePub;
                      rowElements.set(initialDevicePub, element);
                      return () => {
                        rowElements.delete(initialDevicePub);
                      };
                    }}
                    onConfirm={(value) => setConfirming(value ? device().devicePub : null)}
                    onRevoke={() => void revoke(device())}
                  />
                )}
              </For>
            </div>
            <div
              ref={motion.section}
              id={securityId}
              class={["omnipolymath-id-devices__kit", { "omnipolymath-id-owner-enter": securityOpen() }]}
              hidden={!securityOpen()}
            >
              <Show when={ownerFp()}>
                {(fp) => (
                  <>
                    <dl>
                      <dt>{t("omnipolymathId.kitOwnerFingerprint")}</dt>
                      <dd>{fp()}</dd>
                    </dl>
                    <p>{t("omnipolymathId.recoveryKitLine")}</p>
                  </>
                )}
              </Show>
            </div>
            <div class="omnipolymath-id-devices__footer omnipolymath-id-owner-enter">
              <Show when={ownerFp()}>
                <button
                  type="button"
                  class="omnipolymath-id-devices__security"
                  aria-expanded={securityOpen() ? "true" : "false"}
                  aria-controls={securityId}
                  onClick={() => setSecurityOpen((open) => !open)}
                >
                  {t("omnipolymathId.securityDetails")}
                  <Icon name="chevronDown" />
                </button>
              </Show>
              <Show when={localOperator() && ownPub()}>
                <omnipolymath-modal-actions>
                  <button
                    type="button"
                    class="btn primary"
                    onClick={() => {
                      modal.finish(undefined);
                      void showOwnerApprovalDialog({
                        client: params.client,
                        onDevices: () => void showOwnerDevicesDialog(params),
                      });
                    }}
                  >
                    {t("omnipolymathId.approveNewDevice")}
                  </button>
                </omnipolymath-modal-actions>
              </Show>
            </div>
          </div>
        </omnipolymath-modal-dialog>
      );
    });
  });
}
