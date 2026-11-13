import type { Locator, Page } from "playwright";

export function navigationDrawerToggle(page: Page): Locator {
  // The trigger stays visible but becomes inert while its modal drawer is open.
  return page
    .locator("omnipolymath-app-topbar, omnipolymath-chat-page, omnipolymath-new-session-page")
    .getByRole("button", { name: /^(Expand|Collapse) sidebar$/, includeHidden: true })
    .filter({ visible: true })
    .first();
}
