// The recovery kit as Make reachable shows it once: the kit
// code and its facts, save options (download, print/PDF, copy) and
// the "saved" checkbox. A save action that succeeds counts as saved.
import { createSignal, Show } from "solid-js";
import {
  downloadRecoveryKit,
  printRecoveryKit,
  type RecoveryKitDetails,
} from "../../lib/omnipolymath-id/kit-export.ts";
import { omnipolymathIdUiError, type OmnipolymathIdUiError } from "../../lib/omnipolymath-id/ui-error.ts";
import { t } from "../../lib/reactive/i18n.ts";
import { handleCopyButton } from "../copy-button-state.ts";
import { Checkbox } from "../solid/checkbox.tsx";
import { Icon } from "../solid/icon.tsx";
import { OmnipolymathIdErrorMessage } from "./error-message.tsx";
import { RecoveryAccountField, RecoveryCodeField } from "./recovery-kit-form.tsx";

/** The kit, its save options and the "I've saved it" checkbox. */
export function RecoveryKitPanel(props: {
  details: RecoveryKitDetails;
  accountEmail?: string | null;
  saved: boolean;
  onSaved: (saved: boolean) => void;
  statusRef?: (element: HTMLDivElement) => void;
}) {
  let copyLabel!: HTMLSpanElement;
  const [note, setNote] = createSignal<OmnipolymathIdUiError | null>(null);
  const [downloaded, setDownloaded] = createSignal(false);
  const [printed, setPrinted] = createSignal(false);
  // Marks the kit saved after a save action, as ticking the box does.
  const save = async (action: () => boolean | Promise<boolean>, onSuccess?: () => void) => {
    setNote(null);
    try {
      if (await action()) {
        onSuccess?.();
        props.onSaved(true);
      } else {
        setNote({ message: t("omnipolymathId.kitActionUnavailable"), detail: "" });
      }
    } catch (error) {
      setNote(omnipolymathIdUiError(error, "saveKit"));
    }
  };
  return (
    <>
      <div class="omnipolymath-id-kit">
        <RecoveryCodeField code={props.details.kit.text} />
        <div class="oc-dialog__rows">
          <RecoveryAccountField
            accountEmail={props.accountEmail}
            hostname={props.details.hostname}
          />
          <div class="oc-dialog__row">
            <span class="oc-dialog__row-label">{t("omnipolymathId.kitOwnerFingerprint")}</span>
            <span>{props.details.kit.rootFingerprint}</span>
          </div>
          <div class="oc-dialog__row">
            <span class="oc-dialog__row-label">{t("omnipolymathId.kitClaw")}</span>
            <span>https://{props.details.hostname}</span>
          </div>
          <div class="oc-dialog__row">
            <span class="oc-dialog__row-label">{t("omnipolymathId.kitCreated")}</span>
            <span>{props.details.createdAt.toLocaleDateString()}</span>
          </div>
        </div>
      </div>
      <p class="omnipolymath-id-kit__warning">{t("omnipolymathId.kitWarning")}</p>
      <div class="omnipolymath-id-kit__actions">
        <button
          type="button"
          class="btn btn--sm"
          onClick={() =>
            void save(
              () => {
                downloadRecoveryKit(props.details);
                return true;
              },
              () => setDownloaded(true),
            )
          }
        >
          <Show when={downloaded()}>
            <span class="omnipolymath-id-kit__exported">
              <Icon name="check" />
            </span>
          </Show>
          {t("omnipolymathId.downloadKit")}
        </button>
        <button
          type="button"
          class="btn btn--sm"
          onClick={() =>
            void save(
              () => printRecoveryKit(props.details),
              () => setPrinted(true),
            )
          }
        >
          <Show when={printed()}>
            <span class="omnipolymath-id-kit__exported">
              <Icon name="check" />
            </span>
          </Show>
          {t("omnipolymathId.printKit")}
        </button>
        <button
          type="button"
          class="btn btn--sm"
          onClick={(event) =>
            void save(() =>
              handleCopyButton(event, props.details.kit.text, t("common.copy"), {
                label: copyLabel,
              }),
            )
          }
        >
          <span ref={(element) => (copyLabel = element)}>{t("common.copy")}</span>
        </button>
      </div>
      <div class="omnipolymath-id-setup__status" ref={props.statusRef} role="status">
        <Show when={note()}>{(message) => <OmnipolymathIdErrorMessage error={message()} />}</Show>
      </div>
      <label class="field checkbox omnipolymath-id-kit__saved">
        <Checkbox
          checked={props.saved}
          onChange={(event) => props.onSaved(event.currentTarget.checked)}
        />
        <span>{t("omnipolymathId.kitSaved")}</span>
      </label>
    </>
  );
}
