import rules from "./panel-tab-strip.css?inline";

const animation = `@keyframes tabstrip-pulse {
  50% {
    opacity: 0.35;
  }
}`;

export const panelTabStripCss = `${rules}\n${animation}`;
export const nativePanelTabStripCss = `:is(omnipolymath-terminal-panel, omnipolymath-browser-panel, omnipolymath-desktop-panel) {
${rules}
}\n${animation}`;
