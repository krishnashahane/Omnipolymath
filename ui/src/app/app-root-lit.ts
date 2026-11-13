import type { JSX as SolidJSX } from "@solidjs/web";
import { listen } from "../lib/reactive/listener.ts";
import { isNativeWebChromeHost } from "./native-web-chrome.ts";

type RootElementAttributes = SolidJSX.HTMLAttributes<HTMLElement> & {
  [key: `prop:${string}`]: unknown;
};
declare module "@solidjs/web" {
  namespace JSX {
    interface IntrinsicElements {
      "omnipolymath-tooltip-provider": RootElementAttributes;
      "omnipolymath-gateway-url-confirmation": RootElementAttributes;
      "omnipolymath-browser-document": RootElementAttributes;
      "omnipolymath-board-document": RootElementAttributes;
      "omnipolymath-login-gate": RootElementAttributes;
      "omnipolymath-approval-page": RootElementAttributes;
      "omnipolymath-question-page": RootElementAttributes;
      "omnipolymath-session-progress-hovercard-provider": RootElementAttributes;
    }
  }
}

/** Keep focus on the same button when the unported document rerenders its label. */
export function createLegacyFocusEscape(close: () => void): (label: string) => HTMLElement | null {
  let button: HTMLButtonElement | undefined;
  return (label) => {
    if (isNativeWebChromeHost()) {
      return null;
    }
    if (!button) {
      button = document.createElement("button");
      button.className = "btn btn--ghost";
      button.type = "button";
      listen(button, "click", close);
    }
    button.textContent = label;
    return button;
  };
}
