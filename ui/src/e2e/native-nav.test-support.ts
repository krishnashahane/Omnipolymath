import type { Page } from "playwright";

export async function installNativeEmbed(
  page: Page,
  host: { platform: "ios" | "macos" | "android"; formFactor: "phone" | "pad" | "desktop" },
): Promise<void> {
  await page.addInitScript((embed) => {
    Object.assign(window, { __OMNIPOLYMATH_NATIVE_EMBED__: embed });
  }, host);
}

// Mirror the native app's document-start flags and document-end chrome styling.
export async function installNativeWebChrome(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const nativeWindow = window as Window & {
      __OMNIPOLYMATH_NATIVE_WEB_CHROME__?: boolean;
      __OMNIPOLYMATH_NATIVE_HISTORY__?: { canGoBack: boolean; canGoForward: boolean };
    };
    nativeWindow["__OMNIPOLYMATH_NATIVE_WEB_CHROME__"] = true;
    nativeWindow["__OMNIPOLYMATH_NATIVE_HISTORY__"] = {
      canGoBack: false,
      canGoForward: false,
    };
    const stamp = () => {
      document.documentElement.classList.add("omnipolymath-native-macos", "omnipolymath-native-web-chrome");
      document.documentElement.style.setProperty("--omnipolymath-native-titlebar-height", "40px");
      // The app also pads both desktop navigation surfaces past AppKit's
      // window controls (DashboardWindowController.installNativeChromeScript).
      const style = document.createElement("style");
      style.id = "omnipolymath-native-macos-chrome";
      style.textContent = `@media (min-width: 700px) {
        html.omnipolymath-native-macos .sidebar-shell,
        html.omnipolymath-native-macos .settings-sidebar__header {
          padding-top: max(14px, var(--omnipolymath-native-titlebar-height)) !important;
        }
      }`;
      (document.head ?? document.documentElement).appendChild(style);
    };
    if (document.documentElement) {
      stamp();
    } else {
      document.addEventListener("DOMContentLoaded", stamp);
    }
  });
}
