import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import { vi } from "vitest";

const runtimeModule = await import("./runtime.js");
export const handleDiscordActionMock = vi
  .spyOn(runtimeModule, "handleDiscordAction")
  .mockResolvedValue({ content: [], details: { ok: true } });
export const { handleDiscordMessageAction } = await import("./handle-action.js");

export function discordConfig(actions?: Record<string, boolean>): OmnipolymathConfig {
  return {
    channels: { discord: { token: "tok", ...(actions ? { actions } : {}) } },
  } as OmnipolymathConfig;
}
