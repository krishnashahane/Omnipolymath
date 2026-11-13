// Tests runtime queue settings with mocked provider fallback state.
import { describe, expect, it, vi } from "vitest";
import type { OmnipolymathConfig } from "../../../config/types.omnipolymath.js";
import { resolveQueueSettings } from "./settings-runtime.js";

const getLoadedChannelPluginMock = vi.hoisted(() => vi.fn());

vi.mock("../../../channels/plugins/index.js", () => ({
  getLoadedChannelPlugin: getLoadedChannelPluginMock,
}));

describe("resolveQueueSettings runtime defaults", () => {
  it("uses defaults from already-loaded channel plugins", async () => {
    getLoadedChannelPluginMock.mockReturnValueOnce({
      defaults: {
        queue: {
          debounceMs: 125,
        },
      },
    });

    expect(resolveQueueSettings({ cfg: {} as OmnipolymathConfig, channel: "demo" })).toEqual({
      mode: "steer",
      debounceMs: 125,
      cap: 20,
      dropPolicy: "summarize",
    });
    expect(getLoadedChannelPluginMock).toHaveBeenCalledWith("demo");
  });

  it("falls back without loading bundled channel plugins", async () => {
    getLoadedChannelPluginMock.mockReturnValueOnce(undefined);

    expect(resolveQueueSettings({ cfg: {} as OmnipolymathConfig, channel: "telegram" })).toEqual({
      mode: "steer",
      debounceMs: 500,
      cap: 20,
      dropPolicy: "summarize",
    });
    expect(getLoadedChannelPluginMock).toHaveBeenCalledWith("telegram");
  });

  it("applies plugin-channel overrides before global mode and plugin debounce defaults", () => {
    getLoadedChannelPluginMock.mockReturnValueOnce({
      defaults: { queue: { debounceMs: 125 } },
    });

    expect(
      resolveQueueSettings({
        cfg: {
          messages: {
            queue: {
              mode: "steer",
              byChannel: { x: "followup" },
              debounceMsByChannel: { x: 750 },
            },
          },
        },
        channel: " X ",
      }),
    ).toEqual({ mode: "followup", debounceMs: 750, cap: 20, dropPolicy: "summarize" });
  });
});
