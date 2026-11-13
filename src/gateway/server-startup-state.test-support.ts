import { createDeferred } from "../../test/helpers/promise.js";
import { createOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";

export function createStartupGate(afterRelease: () => void = () => {}) {
  const entered = createDeferred();
  const released = createDeferred();
  return {
    entered: entered.promise,
    release: released.resolve,
    run: async () => {
      entered.resolve();
      await released.promise;
      afterRelease();
    },
  };
}

export function createGatewayStartupTestState(
  label: string,
  env: Record<string, string | undefined> = {},
) {
  return createOmnipolymathTestState({
    label,
    layout: "home",
    env: {
      OMNIPOLYMATH_GATEWAY_PASSWORD: undefined,
      OMNIPOLYMATH_GATEWAY_TOKEN: undefined,
      OMNIPOLYMATH_SKIP_BROWSER_CONTROL_SERVER: "1",
      OMNIPOLYMATH_SKIP_CANVAS_HOST: "1",
      OMNIPOLYMATH_SKIP_CHANNELS: "1",
      OMNIPOLYMATH_SKIP_CRON: "1",
      OMNIPOLYMATH_SKIP_GMAIL_WATCHER: "1",
      OMNIPOLYMATH_SKIP_PROVIDERS: "1",
      OMNIPOLYMATH_TEST_MINIMAL_GATEWAY: "0",
      VITEST: "1",
      ...env,
    },
  });
}

export function gatewayStartupTestOptions(token: string) {
  return {
    auth: { mode: "token" as const, token },
    bind: "loopback" as const,
    controlUiEnabled: false,
    sidecarStartup: "defer" as const,
  };
}

export function gatewayStartupTestConfig(port: number, token: string) {
  return { port, auth: { mode: "token" as const, token }, controlUi: { enabled: false } };
}
