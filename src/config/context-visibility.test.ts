// Covers config-controlled context visibility decisions.
import { describe, expect, it } from "vitest";
import type { OmnipolymathConfig } from "./config.js";
import { resolveChannelContextVisibilityMode } from "./context-visibility.js";

describe("resolveChannelContextVisibilityMode", () => {
  it("prefers explicitly provided mode", () => {
    expect(
      resolveChannelContextVisibilityMode({
        cfg: {
          channels: {
            defaults: { contextVisibility: "allowlist_quote" },
            slack: {
              contextVisibility: "all",
              accounts: { work: { contextVisibility: "all" } },
            },
          },
        },
        channel: "slack",
        accountId: "work",
        configuredContextVisibility: "allowlist",
      }),
    ).toBe("allowlist");
  });

  it("falls back to account mode then channel mode then defaults", () => {
    const cfg = {
      channels: {
        defaults: {
          contextVisibility: "allowlist_quote",
        },
        slack: {
          contextVisibility: "allowlist",
          accounts: {
            work: {
              contextVisibility: "all",
            },
          },
        },
      },
    } satisfies OmnipolymathConfig;
    expect(
      resolveChannelContextVisibilityMode({
        cfg,
        channel: "slack",
        accountId: "work",
      }),
    ).toBe("all");
    expect(
      resolveChannelContextVisibilityMode({
        cfg,
        channel: "slack",
        accountId: "missing",
      }),
    ).toBe("allowlist");
    expect(
      resolveChannelContextVisibilityMode({
        cfg: {
          channels: {
            defaults: { contextVisibility: "allowlist_quote" },
          },
        } satisfies OmnipolymathConfig,
        channel: "signal",
      }),
    ).toBe("allowlist_quote");
  });

  it("defaults to all when unset", () => {
    expect(
      resolveChannelContextVisibilityMode({
        cfg: {},
        channel: "telegram",
      }),
    ).toBe("all");
  });
});
