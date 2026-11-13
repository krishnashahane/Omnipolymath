/** Secret-surface projection coverage loaded by the startup SecretRef suite. */
import { describe, expect, it } from "vitest";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { resolveGatewayStartupSourceConfig } from "./server-startup-secret-surfaces.js";

function channelConfig(): OmnipolymathConfig {
  return {
    channels: {
      telegram: {
        botToken: "example",
      },
    },
  };
}

describe("gateway startup secret surfaces", () => {
  it("preserves channel config during ordinary startup", () => {
    const config = channelConfig();
    expect(resolveGatewayStartupSourceConfig(config, {})).toBe(config);
  });

  it.each(["OMNIPOLYMATH_SKIP_CHANNELS", "OMNIPOLYMATH_SKIP_PROVIDERS"] as const)(
    "preserves explicit %s behavior",
    (key) => {
      expect(
        resolveGatewayStartupSourceConfig(channelConfig(), { [key]: "1" }).channels,
      ).toBeUndefined();
    },
  );
});
