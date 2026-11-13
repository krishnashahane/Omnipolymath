import { omnipolymathIdDocumentConfig } from "./omnipolymath-id-document.ts";

/**
 * True when an embedding loader carries this document's Gateway traffic
 * (the Omnipolymath ID claw loader). That loader's Service Worker owns the origin's
 * root scope, so the Control UI must not register its own worker there.
 */
export function hasEmbedderTransport(): boolean {
  return (
    typeof window !== "undefined" &&
    window["__omnipolymathTransport"] !== undefined &&
    omnipolymathIdDocumentConfig() !== null
  );
}

export function isRemoteControlUiIngress(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-omnipolymath-remote-ingress") === "true"
  );
}
