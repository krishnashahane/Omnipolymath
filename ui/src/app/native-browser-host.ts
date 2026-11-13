export function hasNativeBrowserBridge(): boolean {
  const host:
    | (Window & {
        webkit?: { messageHandlers?: { omnipolymathBrowser?: { postMessage?: unknown } } };
      })
    | undefined = typeof window === "undefined" ? undefined : window;
  return typeof host?.webkit?.messageHandlers?.omnipolymathBrowser?.postMessage === "function";
}
