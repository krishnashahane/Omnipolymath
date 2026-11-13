import { on, once } from "node:events";
import type { Server } from "node:http";
import path from "node:path";
import { assert, expect } from "vitest";
import { WebSocket } from "ws";
import {
  formatIrohEndpointKey,
  INGRESS_HEADERS,
} from "../../packages/omnipolymath-id-protocol/src/index.js";
import { upsertSessionEntryCore } from "../config/sessions/session-accessor.js";
import {
  ensureCanonicalUserProfileForOmnipolymathIdIdentity,
  setCanonicalUserProfileRole,
} from "../state/user-profile-writes.js";
import type { OmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";
import { readStoredClaw, writeStoredClaw } from "./omnipolymath-id/claw-store.js";
import { setDeviceTokenBindingOwner } from "./omnipolymath-id/device-token-binding.js";
import { startOmnipolymathIdIngressListener } from "./omnipolymath-id/ingress-listener.js";
import { linkedClaw } from "./omnipolymath-id/omnipolymath-id.test-support.js";
import { createOmnipolymathIdRemovalEffects } from "./omnipolymath-id/removal-effects.js";
import { createOmnipolymathIdService } from "./omnipolymath-id/service.js";
import {
  setOmnipolymathIdTunnelPrincipalLookup,
  setOmnipolymathIdTunnelPrincipalResolver,
} from "./omnipolymath-id/tunnel-principal.js";
import { invalidateOperatorRolePolicy } from "./operator-role-policy.js";
import type { Peer, IngressFrame } from "./remote-control-ui-ingress.integration.test-support.js";
import type { GatewayRequestContext } from "./server-methods/types.js";
import type { GatewayClientRegistry } from "./server/client-registry.js";

export async function createIdRelayMember(params: {
  state: OmnipolymathTestState;
  clients: GatewayClientRegistry;
  context: GatewayRequestContext;
  gatewayServer: () => Server;
  origin: string;
}) {
  const accountId = "relay-member";
  const peerKey = formatIrohEndpointKey(new Uint8Array(32).fill(187));
  const profile = await ensureCanonicalUserProfileForOmnipolymathIdIdentity({ accountId });
  // Local authority survives removal; only the ID-origin approval must end.
  await setCanonicalUserProfileRole(profile.id, "admin", {
    onCommitted: invalidateOperatorRolePolicy,
  });
  await upsertSessionEntryCore(
    { agentId: "main", sessionKey: `agent:main:ingress-${profile.id}` },
    {
      sessionId: `ingress-${profile.id}`,
      updatedAt: Date.now(),
      createdActor: { type: "human", source: "profile", id: profile.id },
      visibility: "draft",
    },
  );
  const claw = await linkedClaw({ read: readStoredClaw, write: writeStoredClaw });
  expect(
    await claw.authority.submit(
      await claw.sign({
        op: "add",
        account_id: accountId,
        role: "operator",
        peer_keys: [peerKey],
        invite_id: null,
      }),
      "tunnel",
    ),
  ).toMatchObject({ ok: true });
  setDeviceTokenBindingOwner({
    lookup: (id, role) => claw.authority.tokenBinding(id, role),
    record: (id, role, key) => claw.authority.bindToken(id, role, key),
    forget: (tokens) => claw.authority.unbindTokens(tokens),
    reportMismatch() {},
  });
  setOmnipolymathIdTunnelPrincipalResolver((key) => claw.authority.resolvePeer(key));
  setOmnipolymathIdTunnelPrincipalLookup(
    (key) => claw.authority.currentPeer(key),
    async () => {
      await claw.authority.load();
    },
  );
  const service = createOmnipolymathIdService({
    getConfig: () => ({ enabled: true }),
    getStateDir: () => params.state.stateDir,
    getGatewayServer: params.gatewayServer,
    createAuthority: async () => claw.authority,
    log: { info() {}, warn() {} },
  });
  service.bindEffects(async () =>
    createOmnipolymathIdRemovalEffects({
      clients: () => params.clients,
      context: () => params.context,
      log: { warn() {} },
    }),
  );
  const tunnel = await startOmnipolymathIdIngressListener({
    socketPath: path.join(params.state.stateDir, "relay-id", "ingress.sock"),
    gatewayServer: params.gatewayServer,
    log: { warn() {} },
  });
  let socket: WebSocket | undefined;
  return {
    profileId: profile.id,
    async open(): Promise<Peer> {
      socket = new WebSocket(`ws+unix:${tunnel.socketPath}:/claw`, {
        origin: params.origin,
        headers: {
          [INGRESS_HEADERS.proxyToken]: tunnel.proxyToken,
          [INGRESS_HEADERS.peerKey]: peerKey,
        },
      });
      const active = socket;
      const messages = on(active, "message");
      await once(active, "open");
      return {
        send: (frame) =>
          new Promise<void>((resolve, reject) => {
            active.send(JSON.stringify(frame), (error) => (error ? reject(error) : resolve()));
          }),
        read: async () => {
          const frame = await messages.next();
          assert(!frame.done, "ID socket closed before its response");
          return JSON.parse(String(frame.value[0])) as IngressFrame;
        },
        close: async () => {
          active.close();
          await messages.return?.();
        },
      };
    },
    async remove() {
      assert(socket, "Missing admitted ID socket");
      const closed = once(socket, "close");
      expect(
        await service.submitStatement(
          "tunnel",
          await claw.sign({
            op: "remove",
            account_id: accountId,
          }),
        ),
      ).toMatchObject({ ok: true });
      await closed;
      expect((await readStoredClaw())?.authority?.members).not.toHaveProperty(accountId);
    },
    async close() {
      socket?.terminate();
      await service.stop();
      setDeviceTokenBindingOwner(undefined);
      setOmnipolymathIdTunnelPrincipalResolver(undefined);
      setOmnipolymathIdTunnelPrincipalLookup(undefined);
      await tunnel.close();
    },
  };
}
