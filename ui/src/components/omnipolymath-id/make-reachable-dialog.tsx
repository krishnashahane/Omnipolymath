import "../../styles/secret-reveal.css";
import "./make-reachable-dialog.css";
import {
  createMemo,
  createSignal,
  Errored,
  For,
  Loading,
  Match,
  onSettled,
  Show,
  Switch,
} from "solid-js";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { registerOmnipolymathIdDialogsEnglish } from "../../i18n/locales/en-omnipolymath-id-dialogs.ts";
import { registerOmnipolymathIdEnglish } from "../../i18n/locales/en-omnipolymath-id.ts";
import { requestOmnipolymathIdLinkCode } from "../../lib/omnipolymath-id/account.ts";
import {
  announceOwnerDeviceKey,
  ensureOwnerDeviceSigner,
} from "../../lib/omnipolymath-id/device-key.ts";
import { omnipolymathIdFeatureSignal } from "../../lib/omnipolymath-id/feature-lifetime.ts";
import type { RecoveryKitDetails } from "../../lib/omnipolymath-id/kit-export.ts";
import {
  LINK_STEPS,
  runLinkSteps,
  type LinkStep,
  type LinkStepState,
} from "../../lib/omnipolymath-id/link-steps.ts";
import { createOmnipolymathIdCeremony, linkCodePageUrl } from "../../lib/omnipolymath-id/link.ts";
import type {
  OmnipolymathIdLinkPreparation,
  OmnipolymathIdPublication,
  OmnipolymathIdSignedIn,
  OmnipolymathIdStatusResult,
} from "../../lib/omnipolymath-id/types.ts";
import { omnipolymathIdUiError, type OmnipolymathIdUiError } from "../../lib/omnipolymath-id/ui-error.ts";
import { registerEnglishCatalog, t } from "../../lib/reactive/i18n.ts";
import { showConfirmDialog } from "../confirm-dialog.ts";
import { handleCopyButton } from "../copy-button-state.ts";
import { withPromiseModalHost } from "../promise-modal-host.ts";
import { DialogHeader } from "../solid/dialog-header.tsx";
import { Icon } from "../solid/icon.tsx";
import { clawNameFromHostname } from "./claw-name.ts";
import { OmnipolymathIdErrorMessage } from "./error-message.tsx";
import { RecoveryKitForm } from "./recovery-kit-form.tsx";
import { RecoveryKitPanel } from "./recovery-kit-panel.tsx";
import { createSetupMotion } from "./setup-motion.ts";

registerEnglishCatalog(registerOmnipolymathIdDialogsEnglish);
registerEnglishCatalog(registerOmnipolymathIdEnglish);

type Step =
  | { kind: "name" }
  | { kind: "kit"; preparation: OmnipolymathIdLinkPreparation; details: RecoveryKitDetails }
  | { kind: "linking"; hostname: string }
  | { kind: "done"; hostname: string; publication: OmnipolymathIdPublication | null }
  | { kind: "failed"; hostname: string; message: OmnipolymathIdUiError };

// The step when it is of `kind`, otherwise false (for <Match when>).
function stepOfKind<K extends Step["kind"]>(
  step: Step,
  kind: K,
): Extract<Step, { kind: K }> | false {
  if (step.kind !== kind) {
    return false;
  }
  // SAFETY: the discriminant was just compared with kind.
  return step as Extract<Step, { kind: K }>;
}

// Whether the claw's outbound relay connection is up (omnipolymathId.status tunnel).
async function readRelayOnline(client: GatewayBrowserClient): Promise<boolean> {
  const result = await client.request<OmnipolymathIdStatusResult>("omnipolymathId.status", {});
  const tunnel = result.status.tunnel;
  return result.status.state === "on" && tunnel?.state === "running" && tunnel.relayOnline === true;
}

// Publication codes distinguish temporary outages from setup and security refusals.
function publicationError(publication: OmnipolymathIdPublication | null): OmnipolymathIdUiError {
  if (publication?.state === "failed") {
    const mapped = omnipolymathIdUiError(publication, "setup");
    if (publication.retryable === true) {
      return { ...mapped, message: `${mapped.message} ${t("omnipolymathId.setupRetrying")}` };
    }
    return ["unavailable", "registration_unavailable"].includes(publication.code)
      ? { ...mapped, message: t("omnipolymathId.publicationStopped") }
      : mapped;
  }
  return {
    message: t(
      publication?.state === "needs_enrollment_code"
        ? "omnipolymathId.doneNeedsLinkCode"
        : "omnipolymathId.publicationPending",
    ),
    detail: "",
  };
}

/** The address Discovery offers for a claw name (omnipolymathId.authority check_name). */
type NameCheck = { name: string; accountTag: string; hostname: string; available: boolean };

/** Emphasize the address without changing the catalog's surrounding copy. */
function AddressMessage(props: { message: string; hostname: string }) {
  const address = () => `https://${props.hostname}`;
  return (
    <For each={props.message.split(address())}>
      {(part, index) => (
        <>
          <Show when={index() > 0}>
            <strong class="omnipolymath-id-setup__address">{address()}</strong>
          </Show>
          {part}
        </>
      )}
    </For>
  );
}

// The name offered until the owner types one.
const DEFAULT_CLAW_NAME = "claw";

/**
 * "Make reachable" (spec section 4; onboarding mockup steps 5-8): the owner
 * names the claw (Discovery assigns "<name>-<account tag>.<loader domain>" for
 * the link code's account); gets the recovery kit
 * and Continue unlocks only after a save action or the confirmation; then four
 * linking steps run in view: signing with the owner key, pinning it on the
 * claw, registration (possession proof and address reservation) and the relay
 * connection. Only signed statements reach the Gateway. Resolves true once linked.
 * When the Control UI is signed in to Omnipolymath ID, the link code comes from the
 * account; otherwise (or if that fails) the owner pastes one.
 */
export function showMakeReachableDialog(params: {
  client: GatewayBrowserClient;
  loaderDomain: string;
  signedIn?: OmnipolymathIdSignedIn | null;
}): Promise<boolean> {
  const ceremony = createOmnipolymathIdCeremony();
  // Closes when the feature turns off; the kit's secrets are dropped however it closes.
  const lifetime = { signal: omnipolymathIdFeatureSignal(), value: false };
  return withPromiseModalHost<boolean>(lifetime, (modal) => {
    modal.render(() => {
      let copyLinkLabel!: HTMLSpanElement;
      const motion = createSetupMotion();
      onSettled(motion.observe);
      const [step, setStep] = createSignal<Step>({ kind: "name" });
      const [saved, setSaved] = createSignal(false);
      const [preparing, setPreparing] = createSignal(false);
      const [enrollmentCode, setEnrollmentCode] = createSignal("");
      const [name, setName] = createSignal(DEFAULT_CLAW_NAME);
      const [check, setCheck] = createSignal<NameCheck | null>(null);
      const [nameError, setNameError] = createSignal<OmnipolymathIdUiError | null>(null);
      const [codeFromAccount, setCodeFromAccount] = createSignal(Boolean(params.signedIn));
      const [codeError, setCodeError] = createSignal<OmnipolymathIdUiError | null>(null);
      const [closeAttempt, setCloseAttempt] = createSignal<{ result: Promise<boolean> }>();
      const closeResult = createMemo(() => closeAttempt()?.result.then(() => null) ?? null);
      const nameRequest = () => ({
        enrollmentCode: enrollmentCode().trim(),
        name: name().trim().toLowerCase(),
      });
      // Asks the Gateway (and through it Discovery) whether the name is free.
      const checkName = async (code = enrollmentCode()) => {
        setCheck(null);
        setNameError(null);
        if (!code.trim() || !nameRequest().name) {
          return;
        }
        try {
          setCheck(
            await params.client.request<NameCheck>("omnipolymathId.authority", {
              action: "check_name",
              ...nameRequest(),
              enrollmentCode: code.trim(),
            }),
          );
        } catch (error) {
          setNameError(omnipolymathIdUiError(error, "setup"));
        }
      };
      // Fills the link code from the signed-in account, then checks the default name.
      const fillCodeFromAccount = async (signedIn: OmnipolymathIdSignedIn) => {
        try {
          const code = await requestOmnipolymathIdLinkCode(params.client, signedIn);
          setEnrollmentCode(code);
          // Solid writes settle later; check the acquired code, not the stale signal.
          await checkName(code);
        } catch (error) {
          setCodeFromAccount(false);
          setCodeError(omnipolymathIdUiError(error, "linkCode"));
        }
      };
      // The account is fixed for this dialog; prefill once it has rendered.
      const signedIn = params.signedIn;
      onSettled(() => {
        if (signedIn) {
          void fillCodeFromAccount(signedIn);
        }
      });
      // Records the address the owner root will sign; Discovery assigns it at registration.
      // One preparation runs at a time, and only the name step accepts its answer, so a
      // late answer never returns the dialog to a step that would make another kit.
      // A plain flag, so a second click in the same tick sees the first one.
      let prepareRunning = false;
      const prepare = async () => {
        if (prepareRunning || modal.settled) {
          return;
        }
        prepareRunning = true;
        setPreparing(true);
        setNameError(null);
        try {
          const preparation = await params.client.request<OmnipolymathIdLinkPreparation>(
            "omnipolymathId.authority",
            { action: "prepare", ...nameRequest() },
          );
          if (modal.settled) {
            return;
          }
          const kit = await ceremony.createKit();
          if (modal.settled) {
            ceremony.discard();
            return;
          }
          const owner = params.signedIn?.email ?? params.signedIn?.name ?? null;
          setSaved(false);
          setStep({
            kind: "kit",
            preparation,
            details: { kit, hostname: preparation.hostname, owner, createdAt: new Date() },
          });
        } catch (error) {
          setNameError(omnipolymathIdUiError(error, "setup"));
        } finally {
          prepareRunning = false;
          setPreparing(false);
        }
      };
      const finish = (linked: boolean) => {
        ceremony.discard();
        modal.finish(linked);
      };
      const [linkStates, setLinkStates] = createSignal<Record<LinkStep, LinkStepState>>(
        // SAFETY: fromEntries over every LINK_STEPS id builds a complete record.
        Object.fromEntries(LINK_STEPS.map((id) => [id, { state: "waiting" }])) as Record<
          LinkStep,
          LinkStepState
        >,
      );
      // The four honest linking steps (lib/omnipolymath-id/link-steps.ts).
      const link = async (preparation: OmnipolymathIdLinkPreparation) => {
        if (modal.settled) {
          return;
        }
        setStep({ kind: "linking", hostname: preparation.hostname });
        let signed: Awaited<ReturnType<typeof ceremony.sign>> | undefined;
        try {
          const publication = await runLinkSteps(
            {
              sign: async () => {
                // Stored before commit, so a lost answer cannot lose the admitted key.
                const device = await ensureOwnerDeviceSigner(preparation.claw_id);
                lifetime.signal?.throwIfAborted();
                signed = await ceremony.sign(preparation, device, t("omnipolymathId.thisBrowser"));
                // The owner key is no longer needed once the statements are signed.
                ceremony.discard();
              },
              commit: async () => {
                lifetime.signal?.throwIfAborted();
                const result = await params.client.request<{
                  publication: OmnipolymathIdPublication | null;
                }>("omnipolymathId.authority", {
                  action: "commit",
                  ...signed,
                  enrollmentCode: nameRequest().enrollmentCode,
                });
                announceOwnerDeviceKey();
                return result.publication;
              },
              relayOnline: () => readRelayOnline(params.client),
            },
            {
              notPublished: (outcome) => publicationError(outcome).message,
              relayOffline: t("omnipolymathId.stepRelayOffline"),
            },
            (id, state) => setLinkStates((current) => ({ ...current, [id]: state })),
          );
          setStep({ kind: "done", hostname: preparation.hostname, publication });
        } catch (error) {
          ceremony.discard();
          setStep({
            kind: "failed",
            hostname: preparation.hostname,
            message: omnipolymathIdUiError(error, "setup"),
          });
        }
      };
      const progress = () => {
        const current = step();
        return current.kind === "linking" || current.kind === "done" || current.kind === "failed"
          ? current
          : false;
      };
      const stepError = (id: LinkStep): OmnipolymathIdUiError | null => {
        const current = step();
        const state = linkStates()[id];
        if (
          current.kind === "done" &&
          id === "reserve" &&
          current.publication?.state !== "published"
        ) {
          return publicationError(current.publication);
        }
        if (current.kind === "failed" && state.state === "failed") {
          return current.message;
        }
        return "message" in state ? { message: state.message, detail: "" } : null;
      };
      const requestClose = async () => {
        if (step().kind === "linking" || modal.settled) {
          return;
        }
        // Every user exit confirms before dropping the once-shown kit.
        if (step().kind === "kit") {
          const result = showConfirmDialog({
            title: t("common.cancel"),
            message: t("omnipolymathId.kitBody"),
            confirmLabel: t("common.cancel"),
            cancelLabel: t("common.back"),
            signal: lifetime.signal,
          });
          setCloseAttempt({ result });
          try {
            if (!(await result)) {
              return;
            }
          } catch {
            // The retained outcome slot shows the error without discarding the kit.
            return;
          }
        }
        if (!modal.settled) {
          finish(step().kind === "done");
        }
      };
      const cancel = (event: Event) => {
        event.preventDefault();
        void requestClose();
      };
      return (
        <omnipolymath-modal-dialog
          class="omnipolymath-id-setup-dialog"
          label={t("omnipolymathId.dialogTitle")}
          description={t("omnipolymathId.dialogDescription")}
          onModal-cancel={cancel}
        >
          <div
            class="oc-dialog omnipolymath-id-setup"
            data-noclose={step().kind === "kit" || step().kind === "linking" ? "" : undefined}
          >
            <DialogHeader
              title={t("omnipolymathId.dialogTitle")}
              description={
                step().kind === "name" && codeFromAccount()
                  ? t("omnipolymathId.signedInLinkCode", {
                      account: signedIn?.email ?? t("omnipolymathId.accountFallback"),
                    })
                  : undefined
              }
              onClose={() => void requestClose()}
              closeDisabled={step().kind === "kit" || step().kind === "linking"}
            />
            <div
              class="oc-dialog__body"
              ref={motion.body}
              data-step={
                progress()
                  ? "progress"
                  : step().kind === "name" && !codeFromAccount()
                    ? "manual"
                    : step().kind
              }
            >
              <Switch>
                <Match when={step().kind === "name"}>
                  <Show when={!codeFromAccount()}>
                    <div class="omnipolymath-id-setup__field">
                      <label for="omnipolymath-id-link-code">{t("omnipolymathId.enrollmentCode")}</label>
                      <div class="omnipolymath-id-setup__inline">
                        <input
                          id="omnipolymath-id-link-code"
                          class="settings-input"
                          type="text"
                          autocomplete="off"
                          spellcheck="false"
                          disabled={preparing()}
                          value={enrollmentCode()}
                          aria-describedby="omnipolymath-id-code-status"
                          onInput={(event) => {
                            setEnrollmentCode(event.currentTarget.value);
                            setCheck(null);
                          }}
                          onChange={() => void checkName()}
                        />
                        <a
                          class="btn"
                          href={linkCodePageUrl(params.loaderDomain)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t("omnipolymathId.getLinkCode")}
                        </a>
                      </div>
                      <div
                        id="omnipolymath-id-code-status"
                        ref={motion.slot}
                        class={["omnipolymath-id-setup__status", { "is-error": Boolean(codeError()) }]}
                        role="status"
                      >
                        <Show when={codeError()} fallback={t("omnipolymathId.enrollmentCodeHint")}>
                          {(error) => <OmnipolymathIdErrorMessage error={error()} />}
                        </Show>
                      </div>
                    </div>
                  </Show>
                  <div class="omnipolymath-id-setup__field">
                    <label for="omnipolymath-id-claw-name">{t("omnipolymathId.clawName")}</label>
                    <input
                      id="omnipolymath-id-claw-name"
                      class="settings-input"
                      type="text"
                      autocomplete="off"
                      spellcheck="false"
                      maxlength={57}
                      disabled={preparing()}
                      value={name()}
                      aria-describedby="omnipolymath-id-name-status"
                      aria-invalid={nameError() || check()?.available === false ? "true" : "false"}
                      onInput={(event) => {
                        setName(event.currentTarget.value);
                        setCheck(null);
                        setNameError(null);
                      }}
                      onChange={() => void checkName()}
                    />
                    <div
                      id="omnipolymath-id-name-status"
                      ref={motion.slot}
                      class={[
                        "omnipolymath-id-setup__status",
                        { "is-error": Boolean(nameError()) || check()?.available === false },
                      ]}
                      role="status"
                    >
                      <Show
                        when={nameError()}
                        fallback={
                          <Show when={check()} fallback={t("omnipolymathId.clawNameHint")}>
                            {(checked) => (
                              <span>
                                <Show
                                  when={checked().available}
                                  fallback={t("omnipolymathId.nameTaken", { host: checked().hostname })}
                                >
                                  <AddressMessage
                                    message={t("omnipolymathId.nameAvailable", {
                                      host: checked().hostname,
                                    })}
                                    hostname={checked().hostname}
                                  />
                                </Show>
                              </span>
                            )}
                          </Show>
                        }
                      >
                        {(error) => <OmnipolymathIdErrorMessage error={error()} />}
                      </Show>
                    </div>
                  </div>
                  <omnipolymath-modal-actions>
                    <button type="button" class="btn" onClick={() => void requestClose()}>
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      class="btn primary"
                      disabled={
                        preparing() ||
                        !nameRequest().enrollmentCode ||
                        !nameRequest().name ||
                        check()?.available === false
                      }
                      onClick={() => void prepare()}
                    >
                      <Show when={preparing()}>
                        <Icon name="loaderCircle" class="omnipolymath-id-setup__spinner" />
                      </Show>
                      {t("omnipolymathId.continue")}
                    </button>
                  </omnipolymath-modal-actions>
                </Match>
                <Match when={stepOfKind(step(), "kit")}>
                  {(kitStep) => (
                    <>
                      <div class="omnipolymath-id-kit__lead">
                        <p>
                          <strong>{t("omnipolymathId.kitTitle")}</strong>
                        </p>
                        <p>{t("omnipolymathId.kitBody")}</p>
                      </div>
                      <RecoveryKitForm
                        details={kitStep().details}
                        accountEmail={params.signedIn?.email}
                        saved={saved()}
                        onContinue={() => void link(kitStep().preparation)}
                      >
                        <RecoveryKitPanel
                          details={kitStep().details}
                          accountEmail={params.signedIn?.email}
                          saved={saved()}
                          onSaved={setSaved}
                          statusRef={motion.slot}
                        />
                        <Loading on={closeAttempt()}>
                          <Errored
                            fallback={(error) => (
                              <div class="callout danger" role="alert">
                                <OmnipolymathIdErrorMessage
                                  error={omnipolymathIdUiError(error(), "setup")}
                                />
                              </div>
                            )}
                          >
                            {closeResult()}
                          </Errored>
                        </Loading>
                        <omnipolymath-modal-actions>
                          <button type="button" class="btn" onClick={() => void requestClose()}>
                            {t("common.cancel")}
                          </button>
                          <button type="submit" class="btn primary" disabled={!saved()}>
                            {t("omnipolymathId.continue")}
                          </button>
                        </omnipolymath-modal-actions>
                      </RecoveryKitForm>
                    </>
                  )}
                </Match>
                <Match when={progress()}>
                  {(current) => (
                    <>
                      <div role="status" aria-live="polite">
                        <p class="omnipolymath-id-linking__title">
                          <Show
                            when={current().kind === "done"}
                            fallback={t("omnipolymathId.linkingTitle", {
                              name: clawNameFromHostname(current().hostname),
                            })}
                          >
                            <AddressMessage
                              message={t("omnipolymathId.doneBody", { host: current().hostname })}
                              hostname={current().hostname}
                            />
                          </Show>
                        </p>
                        <ol class="omnipolymath-id-steps">
                          <For each={LINK_STEPS}>
                            {(id) => (
                              <li
                                class="omnipolymath-id-steps__item"
                                data-state={linkStates()[id].state}
                              >
                                <span
                                  class="omnipolymath-id-steps__mark"
                                  ref={motion.mark}
                                  aria-hidden="true"
                                >
                                  <Icon
                                    name={
                                      linkStates()[id].state === "done"
                                        ? "check"
                                        : linkStates()[id].state === "running"
                                          ? "loaderCircle"
                                          : linkStates()[id].state === "waiting"
                                            ? "circleDashed"
                                            : linkStates()[id].state === "failed"
                                              ? "circleAlert"
                                              : "alertTriangle"
                                    }
                                    class={
                                      linkStates()[id].state === "running"
                                        ? "omnipolymath-id-setup__spinner"
                                        : undefined
                                    }
                                  />
                                </span>
                                <div>
                                  {t(`omnipolymathId.step_${id}`, {
                                    name: clawNameFromHostname(current().hostname),
                                    host: current().hostname,
                                  })}
                                  <Show when={stepError(id)}>
                                    {(error) => (
                                      <div class="omnipolymath-id-steps__message" ref={motion.message}>
                                        <OmnipolymathIdErrorMessage error={error()} />
                                      </div>
                                    )}
                                  </Show>
                                </div>
                              </li>
                            )}
                          </For>
                        </ol>
                      </div>
                      <omnipolymath-modal-actions>
                        <Show when={stepOfKind(step(), "done")}>
                          {(done) => (
                            <Show when={done().publication?.state === "published"}>
                              <button
                                type="button"
                                class="btn"
                                onClick={(event) =>
                                  void handleCopyButton(
                                    event,
                                    `https://${done().hostname}`,
                                    t("omnipolymathId.copyRemoteLink"),
                                    { label: copyLinkLabel },
                                  )
                                }
                              >
                                <Icon name="link" />
                                <span ref={(element) => (copyLinkLabel = element)}>
                                  {t("omnipolymathId.copyRemoteLink")}
                                </span>
                              </button>
                            </Show>
                          )}
                        </Show>
                        <button
                          type="button"
                          class={["btn", { primary: current().kind !== "failed" }]}
                          disabled={current().kind === "linking"}
                          onClick={() => void requestClose()}
                        >
                          {t(current().kind === "failed" ? "common.close" : "omnipolymathId.done")}
                        </button>
                      </omnipolymath-modal-actions>
                    </>
                  )}
                </Match>
              </Switch>
            </div>
          </div>
        </omnipolymath-modal-dialog>
      );
    });
  }).finally(() => ceremony.discard());
}
