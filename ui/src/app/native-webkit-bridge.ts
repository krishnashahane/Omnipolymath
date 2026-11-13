export type WebKitHostMessages = {
  omnipolymathLink: { type: "open-link"; url: string; target: "external" };
  omnipolymathUpdate: { type: "start-update" };
  omnipolymathNav: { type: "nav-state"; collapsed: boolean; width: number };
  omnipolymathWindowDrag: { type: "window-drag" };
  omnipolymathGateways:
    | {
        type: "select" | "open-window" | "set-primary" | "reconnect" | "reconnect-cancel";
        id: string;
      }
    | { type: "open-settings" };
  omnipolymathNotifications:
    | { type: "status" | "request-permission" | "send-test" }
    | {
        type: "background-session-completed";
        runId: string;
        path: string;
        search?: string;
      };
};

type WebKitMessageHandler<Message> = {
  postMessage(message: Message): void;
};

type WebKitHostWindow = Window & {
  webkit?: {
    messageHandlers?: {
      [Name in keyof WebKitHostMessages]?: WebKitMessageHandler<WebKitHostMessages[Name]>;
    };
  };
};

export function webKitHostWindow(): WebKitHostWindow | undefined {
  // SAFETY: WebKit owns this optional ambient bridge and the mapped contract narrows every handler.
  return typeof window === "undefined" ? undefined : (window as WebKitHostWindow);
}
