import path from "node:path";
import { withTempHome as withBaseTempHome } from "omnipolymath/plugin-sdk/test-env";
import {
  closeOmnipolymathStateDatabaseAsync,
  closeOmnipolymathStateDatabaseForTest,
} from "../state/omnipolymath-state-db.js";
import { requesterMcpOAuthIdentity } from "./mcp-oauth-identity.js";

const REQUESTER_SCOPE = { messageChannel: "telegram", agentAccountId: "bot" } as const;

export function requesterIdentity(
  serverName: string,
  serverUrl: string,
  requesterSenderId: string,
) {
  return requesterMcpOAuthIdentity(serverName, serverUrl, {
    ...REQUESTER_SCOPE,
    requesterSenderId,
  });
}

export async function withTempHome<T>(
  run: (home: string) => T | Promise<T>,
  options: Parameters<typeof withBaseTempHome>[1],
): Promise<T> {
  return withBaseTempHome(async (home) => {
    const previousStateDir = process.env.OMNIPOLYMATH_STATE_DIR;
    process.env.OMNIPOLYMATH_STATE_DIR = path.join(home, ".omnipolymath");
    await closeOmnipolymathStateDatabaseAsync();
    closeOmnipolymathStateDatabaseForTest();
    try {
      return await run(home);
    } finally {
      await closeOmnipolymathStateDatabaseAsync();
      closeOmnipolymathStateDatabaseForTest();
      if (previousStateDir === undefined) {
        delete process.env.OMNIPOLYMATH_STATE_DIR;
      } else {
        process.env.OMNIPOLYMATH_STATE_DIR = previousStateDir;
      }
    }
  }, options);
}

export function withMcpOAuthTempHome<T>(run: (home: string) => T | Promise<T>, prefix: string) {
  return withTempHome(run, {
    prefix,
    skipSessionCleanup: true,
    env: { OMNIPOLYMATH_CONFIG_PATH: undefined, OMNIPOLYMATH_STATE_DIR: undefined },
  });
}
