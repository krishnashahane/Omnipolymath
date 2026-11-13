import "./styles.css";
import "./styles/settings-native-controls.css";
import "./styles/checkbox.css";
import { unsupportedControlUiBrowser } from "./app/boot-capabilities.ts";
import { prepareApplicationStartup } from "./app/bootstrap-connection.ts";
import { initializeControlUiDocumentHead } from "./app/control-ui-document-head.ts";
import { startEarlyApplicationGateway } from "./app/early-gateway.ts";
import { omnipolymathIdDocumentConfig } from "./app/omnipolymath-id-document.ts";
import { OMNIPOLYMATH_ID_CALLBACK_PATH } from "./lib/omnipolymath-id/callback-contract.ts";

// The Omnipolymath ID sign-in popup returns to the SPA document; it only hands the
// code back to the tab that opened it and never starts the application.
const omnipolymathIdDocument = omnipolymathIdDocumentConfig();
if (
  omnipolymathIdDocument &&
  window.location.pathname.replace(/\/+$/, "") ===
    `${omnipolymathIdDocument.basePath.replace(/\/+$/, "")}${OMNIPOLYMATH_ID_CALLBACK_PATH}`
) {
  void import("./lib/omnipolymath-id/sign-in-callback.ts").then((callback) =>
    callback.finishOmnipolymathIdCallback(),
  );
} else if (!unsupportedControlUiBrowser) {
  const initial = prepareApplicationStartup();
  initializeControlUiDocumentHead();
  const early = startEarlyApplicationGateway(initial);
  // Keep transport first; the scoped read and validation overlap the application graph.
  initial.prewarmChatSnapshot();
  // Route hints fetch the renderer while the challenge/signature is pending.
  // Cold chat evaluation overlaps the reply; New and admitted cached views
  // must not wait for a challenge from an unreachable Gateway.
  void (
    early?.credentials && !early.credentials.hasWarmBoot
      ? early.transport.client.initialConnectSent
      : Promise.resolve()
  )
    .then(() => import("./main.runtime.ts"))
    .then(({ startControlUi }) => startControlUi(initial, early));
}
