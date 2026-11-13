import { asDateTimestampMs } from "@omnipolymath/normalization-core/number-coercion";
import { createMemo, Show } from "solid-js";
import { formatDateTimeMs, formatRelativeTimestamp } from "../lib/format.ts";
import { i18nRevision } from "../lib/reactive/i18n.ts";
import { readVisibleTime } from "../lib/reactive/visible-clock.ts";

export function RelativeTime(props: { timestampMs?: number | null; class?: string }) {
  const time = createMemo(() => {
    i18nRevision();
    const timestamp = asDateTimestampMs(props.timestampMs);
    if (timestamp === undefined) {
      return undefined;
    }
    readVisibleTime(60_000);
    return {
      datetime: new Date(timestamp).toISOString(),
      title: formatDateTimeMs(timestamp),
      label: formatRelativeTimestamp(timestamp),
    };
  });
  return (
    <omnipolymath-relative-time class={props.class}>
      <Show when={time()}>
        {(current) => (
          <time datetime={current().datetime} title={current().title}>
            {current().label}
          </time>
        )}
      </Show>
    </omnipolymath-relative-time>
  );
}

declare module "@solidjs/web" {
  namespace JSX {
    interface IntrinsicElements {
      "omnipolymath-relative-time": HTMLAttributes<HTMLElement>;
    }
  }
}
