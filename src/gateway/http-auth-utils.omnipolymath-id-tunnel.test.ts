import { ServerResponse } from "node:http";
import { afterEach, expect, it } from "vitest";
import { ensureCanonicalUserProfileForOmnipolymathIdIdentity } from "../state/user-profile-omnipolymath-id.js";
import { withOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";
import { authorizeScopedGatewayHttpRequestOrReply } from "./http-auth-utils.js";
import { assertGatewayHttpRequestCurrent } from "./http-request-authority.js";
import { markGatewayIngressTransport } from "./ingress-attribution.js";
import {
  setOmnipolymathIdTunnelPrincipalLookup,
  setOmnipolymathIdTunnelPrincipalResolver,
  type OmnipolymathIdTunnelPrincipal,
} from "./omnipolymath-id/tunnel-principal.js";
import { AUTH_TOKEN, createRequest } from "./server-http.test-harness.js";

const OWNER_KEY = `iroh:${"1a".repeat(32)}`;
const MEMBER_KEY = `iroh:${"1b".repeat(32)}`;

// The membership the authority admits now; tests edit it while a request is in flight.
const membership = new Map<string, OmnipolymathIdTunnelPrincipal>();

afterEach(() => {
  membership.clear();
  setOmnipolymathIdTunnelPrincipalResolver(undefined);
  setOmnipolymathIdTunnelPrincipalLookup(undefined);
});

function publishMembership() {
  setOmnipolymathIdTunnelPrincipalResolver(async (peerKey) => membership.get(peerKey));
  setOmnipolymathIdTunnelPrincipalLookup((peerKey) => membership.get(peerKey));
}

// Admits a POST /tools/invoke relayed by the tunnel from `peerKey`, as tools-invoke-http does.
async function admitTunnelRequest(peerKey: string) {
  const req = createRequest({ path: "/tools/invoke", method: "POST" });
  markGatewayIngressTransport(req, {
    kind: "omnipolymath-id-tunnel",
    peerKey,
    clientIp: "fd69:726f:6800::1",
  });
  const res = new ServerResponse(req);
  const admitted = await authorizeScopedGatewayHttpRequestOrReply({
    req,
    res,
    auth: AUTH_TOKEN,
    cfg: {},
    getRuntimeConfig: () => ({}),
    operatorMethod: "agent",
  });
  if (!admitted) {
    throw new Error(`tunnel request was not admitted (${res.statusCode})`);
  }
  const close = () => {
    res.destroy();
    req.destroy();
  };
  return { requestAuth: admitted.requestAuth, close };
}

it("an admitted tunnel request loses authority when its device is removed before acting", async () => {
  await withOmnipolymathTestState({ label: "omnipolymath-id-http-removed" }, async () => {
    membership.set(OWNER_KEY, { kind: "owner", peerKey: OWNER_KEY });
    publishMembership();
    const { requestAuth, close } = await admitTunnelRequest(OWNER_KEY);
    try {
      expect(requestAuth.hasCurrentClientAuthority()).toBe(true);
      membership.delete(OWNER_KEY);
      expect(requestAuth.hasCurrentClientAuthority()).toBe(false);
      expect(() => assertGatewayHttpRequestCurrent(requestAuth)).toThrow(
        "Gateway requester authority changed",
      );
      await expect(requestAuth.revalidate()).rejects.toThrow("Unauthorized");
    } finally {
      close();
    }
  });
});

it("a member's request loses authority when the role changes, and when Omnipolymath ID turns off", async () => {
  await withOmnipolymathTestState({ label: "omnipolymath-id-http-role" }, async () => {
    const operator: OmnipolymathIdTunnelPrincipal = {
      kind: "member",
      peerKey: MEMBER_KEY,
      accountId: "acct_op",
      role: "operator",
    };
    membership.set(MEMBER_KEY, operator);
    publishMembership();
    const profile = await ensureCanonicalUserProfileForOmnipolymathIdIdentity({
      accountId: operator.accountId,
      name: "Member",
      email: "member@example.test",
    });
    const first = await admitTunnelRequest(MEMBER_KEY);
    try {
      expect(first.requestAuth.hasCurrentClientAuthority()).toBe(true);
      expect(first.requestAuth.authenticatedUserProfile?.profileId).toBe(profile.id);
      membership.set(MEMBER_KEY, { ...operator, role: "viewer" });
      expect(first.requestAuth.hasCurrentClientAuthority()).toBe(false);
    } finally {
      first.close();
    }
    membership.set(MEMBER_KEY, operator);
    const second = await admitTunnelRequest(MEMBER_KEY);
    try {
      expect(second.requestAuth.hasCurrentClientAuthority()).toBe(true);
      setOmnipolymathIdTunnelPrincipalLookup(undefined);
      expect(second.requestAuth.hasCurrentClientAuthority()).toBe(false);
    } finally {
      second.close();
    }
  });
});
