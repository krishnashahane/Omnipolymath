import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOmnipolymathTestInstance,
  type OmnipolymathTestInstance,
} from "../../test/helpers/omnipolymath-test-instance.js";
import * as gatewayCall from "../gateway/call.js";
import { resolveRuntimeWorkerArgv, resolveRuntimeWorkerUrl } from "../infra/runtime-worker-url.js";
import { stateDirGatewayFixtureEntrypoint } from "./cli-entrypoint.test-support.js";
import { checkCliGatewayStateDir, type GatewayHello } from "./state-dir-gateway-check.js";

describe("state-dir guard with a real token Gateway", () => {
  const token = "state-dir-test-token";
  let gateway: OmnipolymathTestInstance;
  let hello: GatewayHello | undefined;
  const check = (authenticated = true) =>
    checkCliGatewayStateDir({
      command: "omnipolymath channels add",
      config: {
        gateway: {
          mode: "local",
          port: gateway.port,
          auth: { mode: "token", ...(authenticated ? { token } : {}) },
        },
      },
    });

  const setCliStateDir = (stateDir: string) => {
    vi.stubEnv("OMNIPOLYMATH_STATE_DIR", stateDir);
    vi.stubEnv("OMNIPOLYMATH_CONFIG_PATH", path.join(stateDir, "omnipolymath.json"));
  };

  beforeAll(async () => {
    gateway = await createOmnipolymathTestInstance({
      name: "state-dir-server",
      entrypoint: resolveRuntimeWorkerArgv(
        resolveRuntimeWorkerUrl(stateDirGatewayFixtureEntrypoint),
      ),
      gatewayCommandPrefix: [process.execPath],
      gatewayToken: token,
      config: { gateway: { mode: "local" }, hooks: { enabled: false } },
      env: { OMNIPOLYMATH_TEST_GATEWAY_TOKEN: token, OMNIPOLYMATH_DISABLE_BUNDLED_PLUGINS: "1" },
    });
    gateway.env.OMNIPOLYMATH_GATEWAY_PORT = String(gateway.port);
    await gateway.startGateway();
  }, 120_000);

  beforeEach(() => {
    vi.stubEnv("HOME", path.join(gateway.state.root, "cli-home"));
    setCliStateDir(gateway.state.root);
    vi.stubEnv("OMNIPOLYMATH_GATEWAY_PORT", String(gateway.port));
    vi.stubEnv("OMNIPOLYMATH_SYSTEMD_UNIT", `omnipolymath-state-dir-server-${process.pid}`);
    hello = undefined;
    const callGateway = gatewayCall.callGateway;
    vi.spyOn(gatewayCall, "callGateway").mockImplementation((options) =>
      callGateway({
        ...options,
        onHelloOk(value) {
          hello = value;
          options.onHelloOk?.(value);
        },
      }),
    );
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    vi.unstubAllEnvs();
    await gateway.cleanup();
  });

  it("allows matching authenticated hello paths", async () => {
    setCliStateDir(gateway.stateDir);
    await expect(check()).resolves.toEqual({ kind: "allow" });
    expect(hello).toMatchObject({
      snapshot: {
        stateDir: gateway.stateDir,
        configPath: path.join(gateway.stateDir, "omnipolymath.json"),
      },
      auth: { scopes: expect.arrayContaining(["operator.admin"]) },
    });
  });

  it("refuses mismatched authenticated hello paths", async () => {
    const outcome = await check();

    expect(outcome).toMatchObject({
      kind: "refuse",
      message: expect.stringContaining(gateway.stateDir),
    });
    expect(outcome).toHaveProperty("message", expect.stringContaining("live Gateway"));
  });

  it("warns when a tokenless CLI can prove only the Gateway protocol", async () => {
    await expect(check(false)).resolves.toMatchObject({ kind: "warn" });
  });
});
