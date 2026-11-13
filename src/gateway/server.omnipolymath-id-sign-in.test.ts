// Control UI sign-in with Omnipolymath ID (OCF-285) through a real Gateway: only a
// direct-loopback Control UI can start a sign-in. A browser on a hostile Origin is
// refused at connect, a proxied or LAN client is refused at the method, and even
// the loopback operator cannot point the issuer's redirect at a LAN or tunnel origin.
// A proxied connection never reaches a method (403 at the upgrade); a tunnel or LAN
// client is refused at the method (handler level: tunnel attribution comes from the
// ingress listener and a LAN address from a non-loopback socket, neither of which
// this harness can produce).
import { describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { ConnectErrorDetailCodes } from "../../packages/gateway-protocol/src/connect-error-details.js";
import { omnipolymathIdHandlers } from "./server-methods/omnipolymath-id.js";
import type { GatewayRequestHandlerOptions } from "./server-methods/types.js";
import { TEST_OPERATOR_CLIENT, openWs } from "./server.auth.test-helpers.js";
import {
  connectOk,
  connectReq,
  installGatewayTestHooks,
  rpcReq,
  withGatewayServer,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

const OMNIPOLYMATH_ID = {
  enabled: true,
  issuerUrl: "https://issuer.example.test/api/auth",
  clientId: "control-ui",
};
const LOOPBACK_REDIRECT = "http://127.0.0.1:18789/omnipolymath-id/callback";

// Runs `run` against a Gateway with Omnipolymath ID on and sign-in configured.
async function withOmnipolymathIdGateway(run: (port: number) => Promise<void>) {
  const { writeConfigFile } = await import("../config/config.js");
  await writeConfigFile({ gateway: { omnipolymathId: OMNIPOLYMATH_ID } });
  await withGatewayServer(async ({ port }) => run(port));
}

// Starts a sign-in over `ws` and returns the refusal code, if any.
async function beginSignIn(ws: Awaited<ReturnType<typeof openWs>>, redirectUri: string) {
  const res = await rpcReq(ws, "omnipolymathId.authority", { action: "account_begin", redirectUri });
  return res.ok ? undefined : (res.error?.details as { code?: string } | undefined)?.code;
}

describe("Omnipolymath ID sign-in locality", () => {
  test("refuses a browser on a hostile Origin before any method runs", async () => {
    await withOmnipolymathIdGateway(async (port) => {
      const ws = await openWs(port, { origin: "https://evil.example.test" });
      try {
        const res = await connectReq(ws, { client: TEST_OPERATOR_CLIENT, device: null });
        expect(res.ok).toBe(false);
        expect((res.error?.details as { code?: string } | undefined)?.code).toBe(
          ConnectErrorDetailCodes.CONTROL_UI_ORIGIN_NOT_ALLOWED,
        );
      } finally {
        ws.close();
      }
    });
  });

  test("refuses a proxied connection from loopback at the upgrade", async () => {
    await withOmnipolymathIdGateway(async (port) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: { "x-forwarded-for": "192.168.1.20" },
      });
      ws.on("error", () => {});
      const outcome = await new Promise<number | "open">((resolve) => {
        ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
        ws.on("open", () => resolve("open"));
      });
      ws.terminate();
      expect(outcome).toBe(403);
    });
  });

  test("keeps the issuer's redirect on loopback for the direct-loopback operator", async () => {
    await withOmnipolymathIdGateway(async (port) => {
      const ws = await openWs(port);
      try {
        await connectOk(ws, { client: TEST_OPERATOR_CLIENT });
        for (const redirectUri of [
          "http://192.168.1.20:18789/omnipolymath-id/callback",
          "https://studio-k7x2q.crabd.xyz/omnipolymath-id/callback",
        ]) {
          expect(await beginSignIn(ws, redirectUri)).toBe("malformed");
        }
      } finally {
        ws.close();
      }
    });
  });

  test.each([
    [
      "relayed by the tunnel",
      { isLocalClient: true, omnipolymathIdPeerKey: `iroh:${"cd".repeat(32)}` },
    ],
    ["on the LAN", {}],
  ])("refuses a client %s", async (_name, internal) => {
    let refusal: string | undefined;
    await omnipolymathIdHandlers["omnipolymathId.authority"]!({
      params: { action: "account_begin", redirectUri: LOOPBACK_REDIRECT },
      client: { internal },
      respond: (_ok: boolean, _payload: unknown, error?: { details?: { code?: string } }) => {
        refusal = error?.details?.code;
      },
      context: {
        omnipolymathIdService: {},
        getRuntimeConfig: () => ({ gateway: { omnipolymathId: OMNIPOLYMATH_ID } }),
      },
    } as unknown as GatewayRequestHandlerOptions);
    expect(refusal).toBe("not_local_operator");
  });
});
