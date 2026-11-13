import { createOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";
import type { GatewayServerOptions } from "./server-public.js";

export async function createStartupTestState(
  label: string,
  env: Record<string, string | undefined> = {
    OMNIPOLYMATH_GATEWAY_PASSWORD: undefined,
    OMNIPOLYMATH_GATEWAY_TOKEN: undefined,
  },
) {
  const state = await createOmnipolymathTestState({
    label,
    layout: "home",
    env: {
      OMNIPOLYMATH_SKIP_BROWSER_CONTROL_SERVER: "1",
      OMNIPOLYMATH_SKIP_CANVAS_HOST: "1",
      OMNIPOLYMATH_SKIP_CHANNELS: "1",
      OMNIPOLYMATH_SKIP_CRON: "1",
      OMNIPOLYMATH_SKIP_GMAIL_WATCHER: "1",
      OMNIPOLYMATH_SKIP_PROVIDERS: "1",
      OMNIPOLYMATH_TEST_MINIMAL_GATEWAY: "1",
      VITEST: "1",
      ...env,
    },
  });
  return Object.assign(state, { [Symbol.asyncDispose]: state.cleanup });
}

export function gatewayStartupOptions(token: string): GatewayServerOptions {
  return {
    auth: { mode: "token", token },
    bind: "loopback",
    controlUiEnabled: false,
    sidecarStartup: "defer",
  };
}
