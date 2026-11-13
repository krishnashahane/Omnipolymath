import type { JSX } from "@solidjs/web";
import type { ControlUiSessionPullRequest } from "../../../src/gateway/control-ui-contract.js";
import type { ControlUiSurfaceProps } from "../../../src/plugin-sdk/control-ui.js";
import type { ClawHubRecommendation } from "../../../src/shared/clawhub-recommendations.js";
import type { ApplicationGateway } from "../app/gateway.ts";
import type { LobsterPetProps } from "../components/lobster-pet-contract.ts";
import type { MascotMood } from "../components/mascot-pose.ts";
import type { MessageActionDetails } from "../pages/chat/components/chat-message-markdown.types.ts";
export type { JSX } from "@solidjs/web";

// Keep ambient tag contracts independent of renderer modules: SDK declarations include this file.
type LegacyAttributes<T extends HTMLElement> = JSX.HTMLAttributes<T> & JSX.Properties<T>;
type DockElementAttributes = JSX.HTMLAttributes<HTMLElement> & {
  [key: `prop:${string}`]: unknown;
};
type Tooltip = HTMLElementTagNameMap["omnipolymath-tooltip"];

export type ElementProperties<T> = { [Key in keyof T as `prop:${string & Key}`]?: T[Key] };
type ChatCiProperties = {
  gateway?: ApplicationGateway;
  pullRequest?: ControlUiSessionPullRequest;
  sessionKey: string;
  presented: boolean;
  inline?: boolean;
  // Match the native menu registry without pulling renderer modules into SDK declarations.
  controls?: {
    readonly elements: ReadonlySet<HTMLElement>;
    ref(this: void): (element: HTMLElement) => void;
  };
};
type PluginViewProperties = {
  [Surface in keyof ControlUiSurfaceProps]: {
    "prop:surface": Surface;
    "prop:props": ControlUiSurfaceProps[Surface];
  };
}[keyof ControlUiSurfaceProps];

declare module "@solidjs/web" {
  namespace JSX {
    interface EventHandlersElement<T> {
      "onOmnipolymath-composer-dismiss-invocations"?: EventHandlerUnion<T, CustomEvent>;
    }
    interface ExplicitProperties {
      messageActions: MessageActionDetails | null | undefined;
    }
    interface IntrinsicElements {
      "omnipolymath-activity-page": HTMLAttributes<HTMLElement>;
      "omnipolymath-cron-scratch-editor": HTMLAttributes<HTMLElement>;
      "omnipolymath-ip-location": HTMLAttributes<HTMLElement>;
      "omnipolymath-home-session": HTMLAttributes<HTMLElement>;
      "omnipolymath-session-owner-chip": HTMLAttributes<HTMLElement> & {
        size?: "row" | "header";
        attribution?: "created" | "owned" | "archived";
      };
      "omnipolymath-elapsed-time": HTMLAttributes<HTMLElement>;
      "omnipolymath-chat-tool-output": HTMLAttributes<HTMLElement>;
      "omnipolymath-chat-sent-comments": HTMLAttributes<HTMLElement>;
      "omnipolymath-chat-sources": HTMLAttributes<HTMLElement>;
      "omnipolymath-chat-summary-automations": HTMLAttributes<HTMLElement>;
      "omnipolymath-chat-details-progress": HTMLAttributes<HTMLElement>;
      "omnipolymath-microphone-activity": HTMLAttributes<HTMLElement>;
      "omnipolymath-chat-tool-content": HTMLAttributes<HTMLElement>;
      "omnipolymath-chat-tool-raw": HTMLAttributes<HTMLElement>;
      "omnipolymath-chat-tool-outcome": HTMLAttributes<HTMLElement>;
      "omnipolymath-chat-tool-card": HTMLAttributes<HTMLElement>;
      "omnipolymath-chat-tool-icon": HTMLAttributes<HTMLElement>;
      "omnipolymath-chat-tool-reviews": HTMLAttributes<HTMLElement>;
      "omnipolymath-chat-tool-review-outcome": HTMLAttributes<HTMLElement>;
      "omnipolymath-custodian-setup-card": HTMLAttributes<HTMLElement>;
      "omnipolymath-agent-memory-panel": HTMLAttributes<HTMLElement>;
      "omnipolymath-chat-ci-details": HTMLAttributes<HTMLElement> &
        ElementProperties<ChatCiProperties & { menuControls?: boolean }>;
      "omnipolymath-chat-ci-automation": HTMLAttributes<HTMLElement> &
        ElementProperties<ChatCiProperties & { sessionId: string; menuPresentation?: boolean }>;
      "omnipolymath-panel-empty-state": HTMLAttributes<HTMLElement>;
      "omnipolymath-panel-loading-skeleton": HTMLAttributes<HTMLElement> & {
        compact?: string;
        overlay?: string;
      };
      "omnipolymath-terminal-panel": DockElementAttributes & { fullscreen?: boolean };
      "omnipolymath-browser-panel": DockElementAttributes;
      "omnipolymath-link-reader-panel": DockElementAttributes;
      "omnipolymath-appearance-background": HTMLAttributes<HTMLElement>;
      "omnipolymath-config-page": HTMLAttributes<HTMLElement>;
      "omnipolymath-sidebar-update-card": HTMLAttributes<HTMLElement>;
      "omnipolymath-native-chrome-setup": HTMLAttributes<HTMLElement>;
      "omnipolymath-theme-brand-icon": HTMLAttributes<HTMLElement>;
      "omnipolymath-mcp-app-resources": HTMLAttributes<HTMLElement>;
      "omnipolymath-mcp-app-context-strip": HTMLAttributes<HTMLElement>;
      "omnipolymath-mcp-app-panel": HTMLAttributes<HTMLElement>;
      "omnipolymath-meeting-capture-settings": HTMLAttributes<HTMLElement>;
      "omnipolymath-session-storage-settings": HTMLAttributes<HTMLElement>;
      "omnipolymath-talk-settings": HTMLAttributes<HTMLElement>;
      "omnipolymath-memory-settings": HTMLAttributes<HTMLElement>;
      "omnipolymath-memory-memories": HTMLAttributes<HTMLElement>;
      "omnipolymath-modal-actions": HTMLAttributes<HTMLElement>;
      "omnipolymath-templates-explore": HTMLAttributes<HTMLElement> & {
        "prop:onSelect"?: (
          entry: import("../pages/agents-home/templates-catalog-client.ts").TemplateCatalogEntry,
        ) => void;
      };
      "omnipolymath-templates-catalog-dialog": HTMLAttributes<HTMLElement>;
      "omnipolymath-github-identity": HTMLAttributes<HTMLElement>;
      "omnipolymath-chat-permission-card": HTMLAttributes<HTMLElement>;
      "omnipolymath-chat-run-failure-notice": HTMLAttributes<HTMLElement>;
      "omnipolymath-chat-retry-status": HTMLAttributes<HTMLElement>;
      "omnipolymath-session-diff-menu": HTMLAttributes<HTMLElement>;
      "omnipolymath-mcp-servers-card": HTMLAttributes<HTMLElement>;
      "omnipolymath-mcp-app-catalog": HTMLAttributes<HTMLElement> & { surface?: string };
      "omnipolymath-update-run-view": HTMLAttributes<HTMLElement>;
      "omnipolymath-plugins-page": HTMLAttributes<HTMLElement>;
      "omnipolymath-dashboards-page": HTMLAttributes<HTMLElement>;
      "omnipolymath-lobster-pet": HTMLAttributes<HTMLElement> & ElementProperties<LobsterPetProps>;
      // Each caller validates the picker option/callback pairing before the DOM boundary.
      "omnipolymath-select-picker": HTMLAttributes<HTMLElementTagNameMap["omnipolymath-select-picker"]> & {
        "prop:params": unknown;
      };
      "omnipolymath-plugin-view": HTMLAttributes<HTMLElement> &
        PluginViewProperties & {
          "prop:defaultView": unknown;
          "prop:replacementCompanion"?: unknown;
          "prop:presented": boolean;
        };
      "omnipolymath-message-reaction-picker": HTMLAttributes<HTMLElement> & {
        compact?: boolean;
      };
      "omnipolymath-chat-clawhub-card": HTMLAttributes<HTMLElement> & {
        "prop:recommendation"?: ClawHubRecommendation;
        "prop:agentId"?: string;
      };
      "resizable-divider": Omit<HTMLAttributes<HTMLElement>, "onResize"> & {
        "prop:orientation"?: "horizontal" | "vertical";
        "prop:label": string;
        "prop:splitRatio": number;
        "prop:minRatio": number;
        "prop:maxRatio": number;
        "prop:measureRatio"?: () => number;
        "prop:measureSize"?: () => number;
        onResize: (event: CustomEvent<{ splitRatio: number }>) => void;
        "onResize-end"?: () => void;
      };
      "omnipolymath-tooltip": HTMLAttributes<Tooltip> & {
        "prop:content"?: Tooltip["content"];
        "prop:describe"?: Tooltip["describe"];
        "prop:descriptionTarget"?: Tooltip["descriptionTarget"];
        "prop:pointerThrough"?: Tooltip["pointerThrough"];
        "prop:openOnClick"?: Tooltip["openOnClick"];
        "prop:disabled"?: Tooltip["disabled"];
        "prop:anchor"?: Tooltip["anchor"];
        "prop:placement"?: Tooltip["placement"];
        "prop:closeDelay"?: Tooltip["closeDelay"];
        "prop:hoverDismissDelay"?: Tooltip["hoverDismissDelay"];
        "prop:delay"?: Tooltip["delay"];
        "prop:autoSize"?: Tooltip["autoSize"];
        content?: string;
        disabled?: boolean;
        placement?: Tooltip["placement"];
        "open-on-click"?: boolean;
        "auto-size"?: boolean;
      };
      "omnipolymath-viewer-facepile": HTMLAttributes<
        HTMLElementTagNameMap["omnipolymath-viewer-facepile"]
      > &
        ElementProperties<
          Pick<
            HTMLElementTagNameMap["omnipolymath-viewer-facepile"],
            | "staticParticipants"
            | "staticUsers"
            | "presencePayload"
            | "selfUser"
            | "selfInstanceId"
            | "sessionKey"
            | "excludeIdentities"
            | "totalCount"
            | "maxVisible"
            | "overflowInSlots"
            | "personActivity"
          >
        > & { variant?: "session" };
      "omnipolymath-viewer-avatar": HTMLAttributes<HTMLElementTagNameMap["omnipolymath-viewer-avatar"]> &
        ElementProperties<
          Pick<
            HTMLElementTagNameMap["omnipolymath-viewer-avatar"],
            "identity" | "user" | "markAsViewer"
          >
        > & { variant?: HTMLElementTagNameMap["omnipolymath-viewer-avatar"]["variant"] };
      "omnipolymath-link-reader-hovercard-provider": HTMLAttributes<
        HTMLElementTagNameMap["omnipolymath-link-reader-hovercard-provider"]
      > &
        ElementProperties<
          Pick<
            HTMLElementTagNameMap["omnipolymath-link-reader-hovercard-provider"],
            | "client"
            | "readers"
            | "agentId"
            | "sessionKey"
            | "previewSeeds"
            | "pagePreviewContext"
            | "claimedReaders"
          >
        >;
      "omnipolymath-chat-pdf-preview": HTMLAttributes<HTMLElement>;
      "omnipolymath-chat-skill-learned-notice": HTMLAttributes<HTMLElement>;
      "omnipolymath-agent-row-chip": HTMLAttributes<HTMLElement> & {
        "prop:agentId"?: string;
      };
      "omnipolymath-systems-page": HTMLAttributes<HTMLElement>;
      "omnipolymath-systems-sidebar": HTMLAttributes<
        HTMLElementTagNameMap["omnipolymath-systems-sidebar"]
      > &
        ElementProperties<Pick<HTMLElementTagNameMap["omnipolymath-systems-sidebar"], "controller">>;
      "omnipolymath-mascot": LegacyAttributes<HTMLElement> & {
        mood?: MascotMood;
        "prop:size"?: number;
      };
    }
    interface SVGAttributes<T> {
      "xml:space"?: "default" | "preserve";
    }
  }
}
