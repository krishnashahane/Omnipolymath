import type { UiCommandParams } from "@omnipolymath/gateway-protocol";
import {
  KEYBOARD_SHORTCUT_COMBOS,
  matchesShortcutCombo,
} from "../lib/keyboard-shortcut-contract.ts";
import type { BrowserTabTarget } from "./browser/browser-target.ts";

export const TERMINAL_PANEL_TOGGLE_EVENT = "omnipolymath:terminal-toggle";
export const TERMINAL_PANEL_DOCK_BOTTOM_EVENT = "omnipolymath:terminal-dock-bottom";
export const BROWSER_PANEL_TOGGLE_EVENT = "omnipolymath:browser-toggle";
export const DESKTOP_PANEL_TOGGLE_EVENT = "omnipolymath:desktop-toggle";
export const PORTAL_PANEL_TOGGLE_EVENT = "omnipolymath:portal-toggle";
export const HOME_PANEL_TOGGLE_EVENT = "omnipolymath:home-toggle";
export const CUSTODIAN_PANEL_TOGGLE_EVENT = "omnipolymath:custodian-toggle";
export const DEBUG_OVERLAY_REQUEST_EVENT = "omnipolymath:debug-overlay-request";
export const KEYBOARD_SHORTCUTS_REQUEST_EVENT = "omnipolymath:keyboard-shortcuts-request";
export const LINK_READER_PANEL_TOGGLE_EVENT = "omnipolymath:link-reader-panel-toggle";
export type LinkReaderPanelToggleDetail = {
  url?: string;
  newTab?: boolean;
  open?: boolean;
  trigger?: HTMLElement;
  agentId?: string;
};

export const PLUGIN_PANEL_TOGGLE_EVENT = "omnipolymath:plugin-panel-toggle";

export type PluginPanelToggleDetail = {
  pluginId: string;
  panelId: string;
  sessionKey: string;
  agentId?: string;
  open: boolean;
  dock?: "bottom" | "right";
  expanded?: boolean;
};

export const UI_COMMAND_EVENT = "omnipolymath:ui-command";

export type UiCommandDetail = UiCommandParams;

export type TerminalPanelToggleDetail = {
  agentId?: string | null;
  dock?: "bottom" | "right";
  expanded?: boolean;
  newSession?: boolean;
  open?: boolean;
  terminalSessionId?: string;
  agentOwned?: boolean;
};

export type BrowserPanelToggleDetail = {
  dock?: "bottom" | "right";
  expanded?: boolean;
  newTab?: boolean;
  open?: boolean;
  /** Existing tab to focus when the panel opens (browser-tab chat cards). */
  browserTab?: BrowserTabTarget;
  url?: string;
  /** User-opened WKWebView tab on the native macOS host. */
  native?: boolean;
};

export type DesktopPanelToggleDetail = {
  dock?: "bottom" | "right";
  expanded?: boolean;
  open?: boolean;
  environmentId?: string;
};

export type PortalPanelToggleDetail = {
  requestId?: string;
  dock?: "bottom" | "right";
  expanded?: boolean;
  open?: boolean;
  portalId?: string;
  environmentId?: string;
};

export function isTerminalPanelShortcut(event: KeyboardEvent): boolean {
  return matchesShortcutCombo(KEYBOARD_SHORTCUT_COMBOS.terminalPanel, event);
}

export function isHomePanelShortcut(event: KeyboardEvent): boolean {
  return matchesShortcutCombo(KEYBOARD_SHORTCUT_COMBOS.homePanel, event);
}
