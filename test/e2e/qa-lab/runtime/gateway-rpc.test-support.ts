import fs from "node:fs/promises";
import path from "node:path";
import {
  disconnectGatewayClient,
  startGatewayWithClient,
} from "../../../../src/gateway/test-helpers.e2e.js";
import { withEnvAsync } from "../../../../src/test-utils/env.js";
import { isolatedGatewayEnv } from "./gateway-recovery.test-support.js";

type Started = Awaited<ReturnType<typeof startGatewayWithClient>>;

export async function withRpcGateway(
  home: string,
  options: {
    name: string;
    skipProviders?: boolean;
    config?: (workspace: string) => Record<string, unknown>;
    setup?: (workspace: string) => Promise<void>;
  },
  run: (client: Started["client"], workspace: string) => Promise<void>,
) {
  const stateDir = path.join(home, ".omnipolymath");
  const workspace = path.join(home, "workspace");
  const bundledPlugins = path.join(home, "empty-bundled-plugins");
  await Promise.all(
    [stateDir, workspace, bundledPlugins].map((dir) => fs.mkdir(dir, { recursive: true })),
  );
  await options.setup?.(workspace);
  await withEnvAsync(
    {
      ...isolatedGatewayEnv,
      HOME: home,
      USERPROFILE: home,
      OMNIPOLYMATH_STATE_DIR: stateDir,
      OMNIPOLYMATH_CONFIG_PATH: undefined,
      OMNIPOLYMATH_BUNDLED_PLUGINS_DIR: bundledPlugins,
      OMNIPOLYMATH_SKIP_PROVIDERS: options.skipProviders ? "1" : undefined,
      OMNIPOLYMATH_TEST_MINIMAL_GATEWAY: undefined,
    },
    async () => {
      const token = `${options.name}-${process.pid}`;
      let started: Started | undefined;
      try {
        started = await startGatewayWithClient({
          cfg: {
            agents: { defaults: { workspace } },
            ...options.config?.(workspace),
            gateway: { auth: { mode: "token", token } },
          },
          configPath: path.join(stateDir, "omnipolymath.json"),
          token,
          clientDisplayName: `${options.name}-reader`,
        });
        await run(started.client, workspace);
      } finally {
        if (started) {
          await disconnectGatewayClient(started.client).catch(() => undefined);
          await started.server.close({ reason: `${options.name} proof complete` });
        }
      }
    },
  );
}
