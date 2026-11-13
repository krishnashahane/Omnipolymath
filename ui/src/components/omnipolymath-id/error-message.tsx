import { Show } from "solid-js";
import type { OmnipolymathIdUiError } from "../../lib/omnipolymath-id/ui-error.ts";
import { t } from "../../lib/reactive/i18n.ts";

/** Show actionable copy first and keep sanitized diagnostics behind a native disclosure. */
export function OmnipolymathIdErrorMessage(props: { error: OmnipolymathIdUiError }) {
  return (
    <>
      <div>{props.error.message}</div>
      <Show when={props.error.detail}>
        <details>
          <summary>{t("omnipolymathId.technicalDetails")}</summary>
          <div style={{ "overflow-wrap": "anywhere" }}>{props.error.detail}</div>
        </details>
      </Show>
    </>
  );
}
