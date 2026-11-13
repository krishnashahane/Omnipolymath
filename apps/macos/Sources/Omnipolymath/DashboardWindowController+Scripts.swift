import Foundation
import OmnipolymathKit
import WebKit

extension DashboardWindowController {
    static func installNativeChromeScript(into userContentController: WKUserContentController, url: URL) {
        // Deliberately no native fallback for pages that ignore this flag
        // (older gateway bundles, failure pages): they keep their own in-page
        // toggles plus back/forward gestures and the Cmd-[/] menu items.
        let capabilityScript = """
        window.__OMNIPOLYMATH_NATIVE_WEB_CHROME__ = true;
        window.addEventListener('omnipolymath:native-commands-state', () => {
          window.webkit.messageHandlers.omnipolymathCommands.postMessage({type: 'commands-state'});
        });
        """
        userContentController.addUserScript(
            WKUserScript(
                source: ControlUIDocumentHost.scopedDashboardScript(capabilityScript, url: url),
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true))
        // Narrow widths need no rules here: the Control UI's own
        // `html.omnipolymath-native-macos` styles fold the titlebar clearance into
        // the drawer topbar row (layout.mobile.css); their body-qualified
        // !important selectors also outrank the rules older app builds inject.
        let css = """
        \(DashboardDeviceSymbolStyle.css())
        html.omnipolymath-native-macos.omnipolymath-native-web-chrome {
          --omnipolymath-native-titlebar-height: \(DashboardWindowLayout.titlebarHeight)px;
        }
        @media (min-width: 700px) {
          /* Both desktop navigation surfaces must clear AppKit's window controls
             and drag regions or their first interactive row becomes unreachable. */
          html.omnipolymath-native-macos .sidebar-shell,
          html.omnipolymath-native-macos .settings-sidebar__header {
            padding-top: max(14px, var(--omnipolymath-native-titlebar-height)) !important;
          }
        }
        """
        let script = """
        (() => {
          try {
            if (document.getElementById("omnipolymath-native-macos-chrome")) return;
            const style = document.createElement("style");
            style.id = "omnipolymath-native-macos-chrome";
            style.textContent = \(WebViewJavaScriptSupport.jsValue(css));
            document.documentElement.classList.add("omnipolymath-native-macos", "omnipolymath-native-web-chrome");
            document.head.appendChild(style);
          } catch {}
        })();
        """
        userContentController.addUserScript(
            WKUserScript(
                source: ControlUIDocumentHost.scopedDashboardScript(script, url: url),
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true))
    }
}
