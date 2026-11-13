import { webKitHostWindow, type WebKitHostMessages } from "./native-webkit-bridge.ts";

export type NativeNavState = Omit<WebKitHostMessages["omnipolymathNav"], "type">;

export function postNativeNavState(state: NativeNavState): void {
  webKitHostWindow()?.webkit?.messageHandlers?.omnipolymathNav?.postMessage({
    type: "nav-state",
    ...state,
  });
}
