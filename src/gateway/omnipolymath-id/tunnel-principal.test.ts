import { afterEach, describe, expect, it } from "vitest";
import {
  formatIrohEndpointKey,
  randomBytes,
} from "../../../packages/omnipolymath-id-protocol/src/index.js";
import { authorizeHttpGatewayConnect } from "../auth.js";
import type { GatewayIngressAttribution } from "../ingress-attribution.js";
import { createOmnipolymathIdAuthority } from "./authority.js";
import { linkedClaw } from "./omnipolymath-id.test-support.js";
import {
  isOmnipolymathIdTunnelPrincipalCurrent,
  omnipolymathIdRecoveryPrincipalSchema,
  setOmnipolymathIdTunnelPrincipalLookup,
  omnipolymathIdTunnelRolePolicy,
  omnipolymathIdTunnelUser,
  setOmnipolymathIdTunnelPrincipalResolver,
} from "./tunnel-principal.js";

afterEach(() => {
  setOmnipolymathIdTunnelPrincipalResolver(undefined);
  setOmnipolymathIdTunnelPrincipalLookup(undefined);
});

function tunnelAttribution(peerKey: string): GatewayIngressAttribution {
  return {
    kind: "omnipolymath-id-tunnel",
    peerKey,
    clientIp: "fd7a:115c:a1e0::1",
    rateLimit: { subject: { key: `omnipolymath-id:${peerKey}` }, resetOnSuccess: true },
  };
}

describe("Omnipolymath ID tunnel principals", () => {
  it("resolves owner devices, members with their role, and nothing else", async () => {
    const claw = await linkedClaw();
    const op = formatIrohEndpointKey(randomBytes(32));
    const viewer = formatIrohEndpointKey(randomBytes(32));
    for (const [account, role, key] of [
      ["acct-op", "operator", op],
      ["acct-view", "viewer", viewer],
    ] as const) {
      const add = await claw.sign({
        op: "add",
        account_id: account,
        role,
        peer_keys: [key],
        invite_id: null,
      });
      expect(await claw.authority.submit(add, "tunnel")).toMatchObject({ ok: true });
    }
    expect(await claw.authority.resolvePeer(claw.w1)).toMatchObject({
      kind: "owner",
      peerKey: claw.w1,
    });
    expect(await claw.authority.resolvePeer(op)).toMatchObject({
      kind: "member",
      peerKey: op,
      accountId: "acct-op",
      role: "operator",
    });
    expect(await claw.authority.resolvePeer(viewer)).toMatchObject({ role: "viewer" });

    // A role change reconnects the member so the new ceiling applies at once.
    const change = await claw.sign({ op: "set_role", account_id: "acct-view", role: "operator" });
    expect(await claw.authority.submit(change, "tunnel")).toMatchObject({
      ok: true,
      events: expect.arrayContaining([{ type: "disconnect", peer_keys: [viewer] }]),
    });
    expect(await claw.authority.resolvePeer(viewer)).toMatchObject({ role: "operator" });
    expect(
      await claw.authority.resolvePeer(formatIrohEndpointKey(randomBytes(32))),
    ).toBeUndefined();
    expect(await claw.authority.resolvePeer("not-a-key")).toBeUndefined();

    const remove = await claw.sign({ op: "remove", account_id: "acct-op" });
    expect(await claw.authority.submit(remove, "tunnel")).toMatchObject({ ok: true });
    expect(await claw.authority.resolvePeer(op)).toBeUndefined();
  });

  it("caps members by role and leaves owners uncapped", () => {
    const owner = { kind: "owner" as const, peerKey: "iroh:a" };
    const operator = {
      kind: "member" as const,
      peerKey: "iroh:b",
      accountId: "acct-op",
      role: "operator" as const,
    };
    const viewer = { ...operator, role: "viewer" as const };
    expect(omnipolymathIdTunnelRolePolicy(owner)).toBeUndefined();
    expect(omnipolymathIdTunnelUser(owner)).toBeUndefined();
    expect(omnipolymathIdTunnelUser(operator)).toBe("omnipolymath-id:acct-op");
    expect(omnipolymathIdTunnelRolePolicy(operator)?.scopes).toEqual(
      expect.arrayContaining(["operator.read", "operator.write"]),
    );
    expect(omnipolymathIdTunnelRolePolicy(operator)?.scopes).not.toContain("operator.admin");
    expect(omnipolymathIdTunnelRolePolicy(operator)?.scopes).not.toContain("operator.pairing");
    expect(omnipolymathIdTunnelRolePolicy(viewer)?.scopes).toEqual(["operator.read"]);
  });

  it("authenticates admitted tunnel peers as trusted-proxy principals in token mode", async () => {
    const auth = { mode: "token" as const, token: "secret", allowTailscale: false };
    const owner = `iroh:${"1a".repeat(32)}`;
    const member = `iroh:${"1b".repeat(32)}`;
    // A tunnel whose authority is unavailable must not fall through to another door.
    expect(
      await authorizeHttpGatewayConnect({ auth, ingressAttribution: tunnelAttribution(owner) }),
    ).toMatchObject({ ok: false, reason: "omnipolymath_id_not_admitted" });

    setOmnipolymathIdTunnelPrincipalResolver(async (peerKey) =>
      peerKey === owner
        ? { kind: "owner", peerKey }
        : peerKey === member
          ? { kind: "member", peerKey, accountId: "acct-m", role: "viewer" }
          : undefined,
    );
    expect(
      await authorizeHttpGatewayConnect({ auth, ingressAttribution: tunnelAttribution(owner) }),
    ).toEqual({ ok: true, method: "trusted-proxy", omnipolymathId: { kind: "owner", peerKey: owner } });
    expect(
      await authorizeHttpGatewayConnect({ auth, ingressAttribution: tunnelAttribution(member) }),
    ).toMatchObject({ ok: true, method: "trusted-proxy", user: "omnipolymath-id:acct-m" });
    expect(
      await authorizeHttpGatewayConnect({
        auth,
        connectAuth: { token: "secret" },
        ingressAttribution: tunnelAttribution(`iroh:${"1c".repeat(32)}`),
      }),
    ).toEqual({ ok: false, reason: "omnipolymath_id_not_admitted" });
    // Loopback token auth is untouched by the resolver.
    expect(
      await authorizeHttpGatewayConnect({
        auth,
        connectAuth: { token: "secret" },
        ingressAttribution: {
          kind: "direct-local",
          clientIp: "127.0.0.1",
          rateLimit: { subject: { key: "127.0.0.1" }, resetOnSuccess: true },
        },
      }),
    ).toEqual({ ok: true, method: "token" });
  });
});

it("retains the original signed listing across authority reload, not a later approval of the same peer", async () => {
  const claw = await linkedClaw();
  const peer = formatIrohEndpointKey(randomBytes(32));
  const add = () =>
    claw.sign({
      op: "add",
      account_id: "acct-durable",
      role: "operator",
      peer_keys: [peer],
      invite_id: null,
    });
  expect(await claw.authority.submit(await add(), "tunnel")).toMatchObject({ ok: true });
  const admitted = omnipolymathIdRecoveryPrincipalSchema.parse(await claw.authority.resolvePeer(peer));
  const owner = omnipolymathIdRecoveryPrincipalSchema.parse(await claw.authority.resolvePeer(claw.w1));
  const reloaded = createOmnipolymathIdAuthority(claw.store);
  await reloaded.load();
  setOmnipolymathIdTunnelPrincipalLookup((key) => reloaded.currentPeer(key));
  const serialized = JSON.stringify(admitted);
  expect(isOmnipolymathIdTunnelPrincipalCurrent(JSON.parse(serialized))).toBe(true);
  expect(isOmnipolymathIdTunnelPrincipalCurrent(owner)).toBe(true);
  const remove = await claw.sign({ op: "remove", account_id: "acct-durable" });
  expect(await claw.authority.submit(remove, "tunnel")).toMatchObject({ ok: true });
  expect(await claw.authority.submit(await add(), "tunnel")).toMatchObject({ ok: true });
  setOmnipolymathIdTunnelPrincipalLookup((key) => claw.authority.currentPeer(key));
  expect(isOmnipolymathIdTunnelPrincipalCurrent(admitted)).toBe(false);
  expect(isOmnipolymathIdTunnelPrincipalCurrent(owner)).toBe(true);
});
