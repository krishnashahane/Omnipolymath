import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import { describe, expect, it, vi } from "vitest";
import { resolveTelegramMiniAppUrls, TELEGRAM_MINIAPP_URL_ERROR } from "./url.js";

describe("resolveTelegramMiniAppUrls", () => {
  it("resolves HTTPS page and WSS gateway URLs from Tailscale Serve", async () => {
    const runCommand = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({ Self: { DNSName: "host.tailnet.ts.net." } }),
    }));
    const cfg = {
      gateway: {
        tailscale: { mode: "serve" },
        controlUi: { basePath: "/omnipolymath/" },
      },
    } satisfies OmnipolymathConfig;

    await expect(resolveTelegramMiniAppUrls({ cfg, runCommand })).resolves.toEqual({
      pageUrl: "https://host.tailnet.ts.net/__omnipolymath_tg_miniapp/",
      controlUiUrl: "https://host.tailnet.ts.net/omnipolymath",
      gatewayUrl: "wss://host.tailnet.ts.net/omnipolymath",
    });
    expect(runCommand).toHaveBeenCalledWith(["tailscale", "status", "--json"], {
      timeoutMs: 5000,
    });
  });

  it.each([undefined, [" HTTPS://GATEWAY.EXAMPLE:8443 "], ["*"]])(
    "prefers an admitted HTTPS public origin with allowedOrigins=%j",
    async (allowedOrigins) => {
      for (const mode of ["off", "serve"] as const) {
        const cfg: OmnipolymathConfig = {
          gateway: {
            publicOrigin: " https://gateway.example:8443/ ",
            tailscale: { mode },
            controlUi: { basePath: "/omnipolymath/", allowedOrigins },
          },
        };
        const runCommand = vi.fn(async () => ({ code: 1, stdout: "" }));
        await expect(resolveTelegramMiniAppUrls({ cfg, runCommand })).resolves.toEqual({
          pageUrl: "https://gateway.example:8443/__omnipolymath_tg_miniapp/",
          controlUiUrl: "https://gateway.example:8443/omnipolymath",
          gatewayUrl: "wss://gateway.example:8443/omnipolymath",
        });
        expect(runCommand).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    { publicOrigin: "http://localhost:3000" },
    { publicOrigin: "https://gateway.example/path" },
    { publicOrigin: "https://gateway.example", controlUi: { allowedOrigins: [] } },
    {
      publicOrigin: "https://gateway.example",
      controlUi: { allowedOrigins: ["https://host.tailnet.ts.net"] },
    },
  ])("refuses an unusable public origin and retains Tailscale fallback: %j", async (gateway) => {
    await expect(resolveTelegramMiniAppUrls({ cfg: { gateway } })).rejects.toThrow(
      TELEGRAM_MINIAPP_URL_ERROR,
    );
    await expect(
      resolveTelegramMiniAppUrls({
        cfg: { gateway: { ...gateway, tailscale: { mode: "funnel" } } },
        runCommand: async () => ({
          code: 0,
          stdout: JSON.stringify({ Self: { DNSName: "host.tailnet.ts.net." } }),
        }),
      }),
    ).resolves.toEqual({
      pageUrl: "https://host.tailnet.ts.net/__omnipolymath_tg_miniapp/",
      controlUiUrl: "https://host.tailnet.ts.net",
      gatewayUrl: "wss://host.tailnet.ts.net",
    });
  });

  it("fails loud when no public origin is set and Tailscale is off or unavailable", async () => {
    await expect(resolveTelegramMiniAppUrls({ cfg: {} })).rejects.toThrow(
      TELEGRAM_MINIAPP_URL_ERROR,
    );
    await expect(
      resolveTelegramMiniAppUrls({
        cfg: { gateway: { tailscale: { mode: "funnel" } } },
        runCommand: async () => ({ code: 1, stdout: "" }),
      }),
    ).rejects.toThrow(TELEGRAM_MINIAPP_URL_ERROR);
  });
});
