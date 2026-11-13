// SAS confirmation from the original local browser. The domain owner keeps signatures and ordering.
import "./owner-devices-dialog.css";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { registerOmnipolymathIdDialogsEnglish } from "../../i18n/locales/en-omnipolymath-id-dialogs.ts";
import { registerOmnipolymathIdEnglish } from "../../i18n/locales/en-omnipolymath-id.ts";
import { omnipolymathIdFeatureSignal } from "../../lib/omnipolymath-id/feature-lifetime.ts";
import { ownerApprovalFor } from "../../lib/omnipolymath-id/owner-approval-lifetime.ts";
import type { OwnerApproval, OwnerApprovalRequest } from "../../lib/omnipolymath-id/owner-approval.ts";
import { omnipolymathIdUiError } from "../../lib/omnipolymath-id/ui-error.ts";
import { registerEnglishCatalog, t } from "../../lib/reactive/i18n.ts";
import { projectOwner } from "../../lib/reactive/projection.ts";
import { withPromiseModalHost } from "../promise-modal-host.ts";
import { IconButton } from "../solid/icon-button.tsx";
import { OmnipolymathIdErrorMessage } from "./error-message.tsx";
import { createOwnerDialogMotion } from "./owner-dialog-motion.ts";

registerEnglishCatalog(registerOmnipolymathIdDialogsEnglish);
registerEnglishCatalog(registerOmnipolymathIdEnglish);

// Each request owns its optional expiry input, not the cryptographic attempt state.
function ApprovalRow(props: {
  request: OwnerApprovalRequest;
  owner: OwnerApproval;
  onDevices: () => void;
}) {
  const [days, setDays] = createSignal("");
  const expiry = () => (days().trim() ? Number(days()) : null);
  const valid = () =>
    expiry() === null || (Number.isSafeInteger(expiry()) && expiry()! > 0 && expiry()! <= 3650);
  const inactive = () => props.request.expired || props.request.uncertain;
  const error = createMemo(() =>
    props.request.error ? omnipolymathIdUiError(props.request.error, "approval") : null,
  );
  return (
    <section class="omnipolymath-id-approval__request">
      <strong class="omnipolymath-id-approval__browser omnipolymath-id-owner-enter">
        {props.request.label}
      </strong>
      <Show when={!props.request.error && !props.request.expired}>
        <p class="omnipolymath-id-devices__description omnipolymath-id-owner-enter">
          {t("omnipolymathId.approvalCompare")}
        </p>
      </Show>
      <Show when={error()}>
        {(message) => (
          <div class="omnipolymath-id-devices__error omnipolymath-id-owner-enter" role="alert">
            {message().message}
          </div>
        )}
      </Show>
      <Show when={props.request.code || !inactive()}>
        <div
          class={[
            "omnipolymath-id-approval__number",
            { "omnipolymath-id-approval__number--inactive": inactive() },
          ]}
          aria-live="polite"
        >
          <Show
            when={props.request.code}
            fallback={
              <span class="omnipolymath-id-approval__waiting omnipolymath-id-owner-enter">
                <span class="btn__spinner" aria-hidden="true" />
                {t("omnipolymathId.approvalWaiting")}
              </span>
            }
          >
            {(code) => (
              <span class="omnipolymath-id-owner-enter">
                {code().replace(/^(\d{3})(\d{3})$/, "$1 $2")}
              </span>
            )}
          </Show>
        </div>
      </Show>
      <Show when={error()?.detail}>
        {(detail) => (
          <details class="omnipolymath-id-approval__details omnipolymath-id-owner-enter">
            <summary>{t("omnipolymathId.technicalDetails")}</summary>
            <div>{detail()}</div>
          </details>
        )}
      </Show>
      <Show when={!inactive()}>
        <label class="omnipolymath-id-approval__expiry omnipolymath-id-owner-enter">
          <span>
            {t("omnipolymathId.regenExpiry")}
            <small>{t("omnipolymathId.regenExpiryHint")}</small>
          </span>
          <input
            type="number"
            min="1"
            max="3650"
            inputmode="numeric"
            value={days()}
            onInput={(event) => setDays(event.currentTarget.value)}
            disabled={props.request.busy}
          />
        </label>
        <omnipolymath-modal-actions class="exec-approval-actions omnipolymath-id-owner-enter">
          <button
            type="button"
            class="btn"
            disabled={props.request.busy}
            onClick={() => void props.owner.decide(props.request.id, false)}
          >
            {t("omnipolymathId.approvalDeny")}
          </button>
          <button
            type="button"
            class="btn primary"
            disabled={props.request.busy || !props.request.code || !valid()}
            onClick={() => {
              const duration = expiry();
              void props.owner.decide(
                props.request.id,
                true,
                duration === null ? null : Math.floor(Date.now() / 1000) + duration * 86400,
              );
            }}
          >
            {t("omnipolymathId.approvalApprove")}
          </button>
        </omnipolymath-modal-actions>
      </Show>
      <Show when={props.request.uncertain}>
        <omnipolymath-modal-actions class="exec-approval-actions omnipolymath-id-owner-enter">
          <button type="button" class="btn primary" onClick={() => props.onDevices()}>
            {t("omnipolymathId.yourDevices")}
          </button>
        </omnipolymath-modal-actions>
      </Show>
    </section>
  );
}

/** Shows pending requests with their six-digit matching numbers; never offers an unsigned approval. */
export function showOwnerApprovalDialog(params: {
  client: GatewayBrowserClient;
  onDevices: () => void;
}): Promise<void> {
  const owner = ownerApprovalFor(params.client);
  // Closes when the feature turns off.
  const lifetime = { signal: omnipolymathIdFeatureSignal(), value: undefined };
  return withPromiseModalHost<void>(lifetime, (modal) => {
    modal.render(() => {
      const motion = createOwnerDialogMotion();
      const projection = owner ? projectOwner(owner, (value) => value.read()) : null;
      return (
        <omnipolymath-modal-dialog
          class="omnipolymath-id-owner-dialog omnipolymath-id-owner-dialog--approval"
          label={t("omnipolymathId.approveNewDevice")}
          onModal-cancel={() => modal.finish(undefined)}
        >
          <div ref={motion.card} class="exec-approval-card omnipolymath-id-devices">
            <h2 class="omnipolymath-id-devices__title">{t("omnipolymathId.approveNewDevice")}</h2>
            <IconButton
              class="omnipolymath-id-devices__close"
              icon="x"
              label={t("common.close")}
              tooltip={false}
              onClick={() => modal.finish(undefined)}
            />
            <Show when={!owner}>
              <p class="callout info omnipolymath-id-owner-enter">
                {t("omnipolymathId.approvalRequiresKey")}
              </p>
            </Show>
            <Show when={projection?.read().error}>
              {(message) => (
                <div class="omnipolymath-id-devices__error omnipolymath-id-owner-enter" role="alert">
                  <OmnipolymathIdErrorMessage error={omnipolymathIdUiError(message(), "approval")} />
                  <Show when={!projection?.read().requests.some((request) => request.uncertain)}>
                    <omnipolymath-modal-actions class="exec-approval-actions">
                      <button type="button" class="btn primary" onClick={() => owner?.retry()}>
                        {t("common.retry")}
                      </button>
                    </omnipolymath-modal-actions>
                  </Show>
                </div>
              )}
            </Show>
            <Show
              when={owner && !projection?.read().error && projection?.read().requests.length === 0}
            >
              <p class="omnipolymath-id-devices__description omnipolymath-id-approval__empty omnipolymath-id-owner-enter">
                {t("omnipolymathId.approvalEmpty")}
              </p>
            </Show>
            <For each={projection?.read().requests ?? []} keyed={(request) => request.id}>
              {(request) => (
                <ApprovalRow
                  request={request()}
                  owner={owner!}
                  onDevices={() => {
                    modal.finish(undefined);
                    params.onDevices();
                  }}
                />
              )}
            </For>
          </div>
        </omnipolymath-modal-dialog>
      );
    });
  });
}
