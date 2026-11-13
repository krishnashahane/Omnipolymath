import "../../styles/exec-approval-card.css";
// "Move to new keys" from the account menu, on the computer that runs the claw: the recovery
// code typed here signs the new binding in this browser (lib/omnipolymath-id/rebind.ts), the
// owner confirms the key fingerprints, and the Gateway stores it and publishes the new keys.
import { createSignal, Match, onSettled, Show, Switch } from "solid-js";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { registerOmnipolymathIdDialogsEnglish } from "../../i18n/locales/en-omnipolymath-id-dialogs.ts";
import { registerOmnipolymathIdEnglish } from "../../i18n/locales/en-omnipolymath-id.ts";
import {
  guardOmnipolymathIdAccount,
  subscribeOmnipolymathIdAccount,
} from "../../lib/omnipolymath-id/account.ts";
import { omnipolymathIdFeatureSignal } from "../../lib/omnipolymath-id/feature-lifetime.ts";
import {
  cancelRebind,
  commitRebind,
  prepareRebind,
  type RebindCommitResult,
  type RebindPlan,
  type RebindRefusal,
} from "../../lib/omnipolymath-id/rebind.ts";
import type { OmnipolymathIdSignedIn } from "../../lib/omnipolymath-id/types.ts";
import { omnipolymathIdUiError, type OmnipolymathIdUiError } from "../../lib/omnipolymath-id/ui-error.ts";
import { registerEnglishCatalog, t } from "../../lib/reactive/i18n.ts";
import { listen } from "../../lib/reactive/listener.ts";
import { showToast } from "../../lib/toast.ts";
import { withPromiseModalHost } from "../promise-modal-host.ts";
import { OmnipolymathIdErrorMessage } from "./error-message.tsx";

registerEnglishCatalog(registerOmnipolymathIdDialogsEnglish);
registerEnglishCatalog(registerOmnipolymathIdEnglish);

/** Plain copy for a signing refusal; nothing was signed. */
export function rebindRefusalMessage(refusal: RebindRefusal, hostname: string): string {
  switch (refusal.code) {
    case "bad_kit":
      return t("omnipolymathId.moveKeysBadKit");
    case "wrong_kit":
      return t("omnipolymathId.moveKeysWrongKit", { fp: refusal.kitRoot, host: hostname });
    case "published_unverifiable":
      return t("omnipolymathId.moveKeysUnverifiable");
    case "published_unavailable":
    case "binding_seq_too_low":
      return t("omnipolymathId.moveKeysUnavailable");
    default:
      return refusal satisfies never;
  }
}

function KeyRow(props: { label: string; from: string; to: string }) {
  return (
    <div class="omnipolymath-id-move-keys__row exec-approval-meta-row">
      <span>{props.label}</span>
      <span>
        <span class="omnipolymath-id-move-keys__fp mono">{props.from}</span> →{" "}
        <span class="omnipolymath-id-move-keys__fp mono">{props.to}</span>
      </span>
    </div>
  );
}

/** Resolves true once the claw moved to new keys, false when closed without moving. */
export function showMoveKeysDialog(params: {
  client: GatewayBrowserClient;
  signedIn: OmnipolymathIdSignedIn;
  hostname: string;
}): Promise<boolean> {
  const assertAccount = guardOmnipolymathIdAccount(params.signedIn);
  const feature = omnipolymathIdFeatureSignal();
  if (feature.aborted) {
    return Promise.resolve(false);
  }
  return withPromiseModalHost<boolean>(undefined, (modal) => {
    modal.render(() => {
      const [kit, setKit] = createSignal("");
      const [plan, setPlan] = createSignal<RebindPlan | null>(null);
      const [busy, setBusy] = createSignal(false);
      const [refused, setRefused] = createSignal<string | null>(null);
      const [error, setError] = createSignal<OmnipolymathIdUiError | null>(null);
      const fail = (cause: unknown) => setError(omnipolymathIdUiError(cause, "setup"));
      // Plain, not a signal: dismissal must see an operation the moment it starts. While one
      // runs the dialog stays open, so a commit's outcome is always shown, never dropped.
      let inFlight = false;
      let committing = false;
      let retired = false;
      // Byte secrets are zeroed where they are made: signRebind zeroes the kit secret S and the
      // derived seed, and R stays a non-extractable CryptoKey that is dropped. The typed code and
      // the signed binding are JS strings, which cannot be overwritten: on close they are
      // released here and scrubbed from the field, so nothing keeps them reachable.
      let input: HTMLInputElement | undefined;
      const retire = () => {
        retired = true;
        setPlan(null);
        setKit("");
        if (input) {
          input.value = "";
          input.defaultValue = "";
        }
        // Once dispatched, a commit owns settlement even after Labs or account retirement.
        if (!committing) {
          modal.finish(false);
        }
      };
      onSettled(() => {
        const unsubscribe = subscribeOmnipolymathIdAccount(() => {
          try {
            assertAccount();
          } catch {
            retire();
          }
        });
        const stopFeature = listen(feature, "abort", retire, { once: true });
        if (feature.aborted) {
          retire();
        }
        return () => {
          unsubscribe();
          stopFeature();
          if (input) {
            input.value = "";
            input.defaultValue = "";
          }
          setKit("");
          setPlan(null);
        };
      });
      const run = async (operation: () => Promise<void>) => {
        inFlight = true;
        setBusy(true);
        try {
          await operation();
        } finally {
          inFlight = false;
          setBusy(false);
        }
      };

      const check = (kitText: string) =>
        run(async () => {
          setRefused(null);
          setError(null);
          try {
            const result = await prepareRebind({
              client: params.client,
              signedIn: params.signedIn,
              kitText,
            });
            if (retired || modal.settled) {
              return;
            }
            if (result.ok) {
              setKit("");
              setPlan(result.plan);
            } else {
              setRefused(rebindRefusalMessage(result, params.hostname));
            }
          } catch (cause) {
            if (retired || modal.settled) {
              return;
            }
            fail(cause);
          }
        });

      const move = (current: RebindPlan) =>
        run(async () => {
          setError(null);
          let result: RebindCommitResult;
          try {
            if (retired || feature.aborted) {
              retire();
              return;
            }
            committing = true;
            result = await commitRebind(params.client, current);
          } catch (cause) {
            if (retired) {
              showToast({ severity: "error", message: omnipolymathIdUiError(cause, "setup").message });
              modal.finish(false);
            } else {
              fail(cause);
            }
            return;
          } finally {
            committing = false;
          }
          setPlan(null);
          showToast(
            result.followUpError === undefined
              ? { severity: "success", message: t("omnipolymathId.moveKeysDone") }
              : {
                  severity: "warning",
                  message: t("omnipolymathId.moveKeysDone"),
                  description: t("omnipolymathId.moveKeysFollowUpFailed", { command: result.nextStep }),
                  detail: result.followUpError,
                },
          );
          modal.finish(true);
        });

      const close = (event?: Event) => {
        if (inFlight) {
          event?.preventDefault();
          return;
        }
        if (plan()) {
          void cancelRebind(params.client).catch(() => undefined);
        }
        setPlan(null);
        setKit("");
        modal.finish(false);
      };

      return (
        <omnipolymath-modal-dialog label={t("omnipolymathId.moveToNewKeys")} onModal-cancel={close}>
          <div class="exec-approval-card omnipolymath-id-move-keys">
            <h2>{t("omnipolymathId.moveToNewKeys")}</h2>
            <p>{t("omnipolymathId.moveKeysBody", { host: params.hostname })}</p>
            <Switch>
              <Match when={plan()}>
                {(current) => (
                  <>
                    <h3>{t("omnipolymathId.moveKeysConfirm")}</h3>
                    <div class="omnipolymath-id-move-keys__keys exec-approval-meta">
                      <div class="omnipolymath-id-move-keys__row exec-approval-meta-row">
                        <span>{t("omnipolymathId.moveKeysRoot")}</span>
                        <span>
                          <span class="omnipolymath-id-move-keys__fp mono">{current().root}</span>{" "}
                          <span class="muted">{t("omnipolymathId.moveKeysRootMatches")}</span>
                        </span>
                      </div>
                      <KeyRow
                        label={t("omnipolymathId.moveKeysBinding")}
                        from={String(current().bindingSeq.from)}
                        to={String(current().bindingSeq.to)}
                      />
                      <KeyRow
                        label={t("omnipolymathId.moveKeysEndpoint")}
                        from={current().endpoint.from}
                        to={current().endpoint.to}
                      />
                      <KeyRow
                        label={t("omnipolymathId.moveKeysGateway")}
                        from={current().gateway.from}
                        to={current().gateway.to}
                      />
                    </div>
                  </>
                )}
              </Match>
              <Match when={!plan()}>
                <form
                  id="omnipolymath-id-move-keys-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void check(kit());
                  }}
                >
                  <label class="field">
                    <span>{t("omnipolymathId.moveKeysKit")}</span>
                    <input
                      ref={(element) => (input = element)}
                      type="password"
                      name="recovery-code"
                      autocomplete="off"
                      spellcheck="false"
                      class="mono"
                      value={kit()}
                      disabled={busy()}
                      onInput={(event) => setKit(event.currentTarget.value)}
                    />
                    <small>{t("omnipolymathId.moveKeysKitHint")}</small>
                  </label>
                </form>
              </Match>
            </Switch>
            <Show when={refused()}>
              {(message) => (
                <p class="callout danger" role="alert">
                  {message()}
                </p>
              )}
            </Show>
            <Show when={error()}>
              {(current) => (
                <div class="callout danger" role="alert">
                  <OmnipolymathIdErrorMessage error={current()} />
                </div>
              )}
            </Show>
            <omnipolymath-modal-actions class="exec-approval-actions">
              <button type="button" class="btn" disabled={busy()} onClick={close}>
                {t("common.cancel")}
              </button>
              <Show
                when={plan()}
                fallback={
                  <button
                    type="submit"
                    form="omnipolymath-id-move-keys-form"
                    class="btn primary"
                    disabled={busy() || !kit().trim()}
                  >
                    {t("omnipolymathId.moveKeysCheck")}
                  </button>
                }
              >
                {(current) => (
                  <button
                    type="button"
                    class="btn primary"
                    disabled={busy()}
                    onClick={() => void move(current())}
                  >
                    {t("omnipolymathId.moveKeysMove")}
                  </button>
                )}
              </Show>
            </omnipolymath-modal-actions>
          </div>
        </omnipolymath-modal-dialog>
      );
    });
  });
}
