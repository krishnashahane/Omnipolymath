import { afterEach, describe, expect, it } from "vitest";
import { checkGatewayWsBrowserOrigin } from "../origin-check.js";
import { createOmnipolymathIdAuthority } from "./authority.js";
import {
  clawOriginOfRecord,
  isOmnipolymathIdClawOrigin,
  setOmnipolymathIdClawOriginResolver,
} from "./claw-origin.js";
import { linkedClaw, memoryStore, TEST_K_SRV } from "./omnipolymath-id.test-support.js";

const CLAW = "https://studio-k7x2q.claws.example.test";

afterEach(() => setOmnipolymathIdClawOriginResolver(undefined));

describe("Omnipolymath ID claw origin", () => {
  it("is the hostname of the linked claw's owner-signed binding", async () => {
    const claw = await linkedClaw();
    expect(claw.authority.current()?.binding?.body.hostname).toBe(
      "studio-k7x2q.claws.example.test",
    );
    expect(clawOriginOfRecord(claw.authority.current())).toBe(CLAW);
  });

  it("follows a re-link: the new binding's hostname replaces the old one", async () => {
    const claw = await linkedClaw();
    const record = claw.authority.current()!;
    const relinked = {
      ...record,
      binding: {
        ...record.binding!,
        body: { ...record.binding!.body, hostname: "lab-k7x2q.claws.example.test" },
      },
    };
    setOmnipolymathIdClawOriginResolver(() => clawOriginOfRecord(relinked));
    expect(isOmnipolymathIdClawOrigin("https://lab-k7x2q.claws.example.test")).toBe(true);
    expect(isOmnipolymathIdClawOrigin(CLAW)).toBe(false);
  });

  it("does not exist after an unlink (no authority)", async () => {
    const claw = await linkedClaw();
    expect(clawOriginOfRecord({ ...claw.authority.current()!, authority: null })).toBeUndefined();
  });

  it("does not exist for a hostname that is only prepared", async () => {
    const authority = createOmnipolymathIdAuthority(memoryStore());
    const prep = await authority.prepareLink({
      kSrv: TEST_K_SRV,
      kGw: `ed25519:${"11".repeat(32)}`,
      hostname: "studio-k7x2q.claws.example.test",
    });
    expect("ok" in prep).toBe(false);
    expect(authority.current()?.hostname).toBe("studio-k7x2q.claws.example.test");
    expect(clawOriginOfRecord(authority.current())).toBeUndefined();
  });

  it("matches the published origin only, case-insensitively", () => {
    setOmnipolymathIdClawOriginResolver(() => CLAW);
    expect(isOmnipolymathIdClawOrigin("https://STUDIO-k7x2q.claws.example.test")).toBe(true);
    expect(isOmnipolymathIdClawOrigin("https://team-k7x2q.claws.example.test")).toBe(false);
    expect(isOmnipolymathIdClawOrigin("http://studio-k7x2q.claws.example.test")).toBe(false);
    expect(isOmnipolymathIdClawOrigin(undefined)).toBe(false);
    setOmnipolymathIdClawOriginResolver(undefined);
    expect(isOmnipolymathIdClawOrigin(CLAW)).toBe(false);
  });
});

describe("WebSocket origin policy for a linked claw", () => {
  const tunnel = {
    origin: CLAW,
    requestHost: "localhost",
    isLocalClient: false,
    omnipolymathIdTunnel: true,
  };

  it("accepts the claw's own origin over the tunnel without allowedOrigins", () => {
    setOmnipolymathIdClawOriginResolver(() => CLAW);
    expect(checkGatewayWsBrowserOrigin(tunnel, {})).toEqual({
      ok: true,
      matchedBy: "omnipolymath-id-claw",
    });
  });

  it("refuses it before the claw is linked and after Omnipolymath ID stops", () => {
    expect(checkGatewayWsBrowserOrigin(tunnel, {}).ok).toBe(false);
    setOmnipolymathIdClawOriginResolver(() => undefined);
    expect(checkGatewayWsBrowserOrigin(tunnel, {}).ok).toBe(false);
  });

  it("refuses the claw origin on a connection that did not come through the tunnel", () => {
    setOmnipolymathIdClawOriginResolver(() => CLAW);
    const { omnipolymathIdTunnel: _tunnel, ...direct } = tunnel;
    expect(checkGatewayWsBrowserOrigin(direct, {}).ok).toBe(false);
  });

  it("refuses a different claw address under the same loader domain over the tunnel", () => {
    setOmnipolymathIdClawOriginResolver(() => "https://studio-e61zr.crabd.xyz");
    const own = { ...tunnel, origin: "https://studio-e61zr.crabd.xyz" };
    expect(checkGatewayWsBrowserOrigin(own, {}).ok).toBe(true);
    for (const origin of [
      "https://team-e61zr.crabd.xyz",
      "https://studio-q9w4k.crabd.xyz",
      "https://crabd.xyz",
      "https://studio-e61zr.crabd.xyz.evil.example",
      "https://studio-e61zr.crabd.xyz:8443",
    ]) {
      expect(checkGatewayWsBrowserOrigin({ ...tunnel, origin }, {}).ok, origin).toBe(false);
    }
  });

  it("refuses another claw's origin over the tunnel", () => {
    setOmnipolymathIdClawOriginResolver(() => CLAW);
    const other = { ...tunnel, origin: "https://team-k7x2q.claws.example.test" };
    expect(checkGatewayWsBrowserOrigin(other, {}).ok).toBe(false);
  });

  it("leaves direct loopback unchanged: local rules still decide, the claw origin is not special", () => {
    setOmnipolymathIdClawOriginResolver(() => CLAW);
    const local = {
      origin: "http://localhost:18790",
      requestHost: "localhost:18790",
      isLocalClient: true,
    };
    expect(checkGatewayWsBrowserOrigin(local, {}).ok).toBe(true);
    const claw = { origin: CLAW, requestHost: "localhost:18790", isLocalClient: true };
    expect(checkGatewayWsBrowserOrigin(claw, {}).ok).toBe(false);
  });

  it("keeps the configured allowlist working over the tunnel", () => {
    const other = { ...tunnel, origin: "https://team-k7x2q.claws.example.test" };
    const cfg = { gateway: { controlUi: { allowedOrigins: [other.origin] } } };
    expect(checkGatewayWsBrowserOrigin(other, cfg).ok).toBe(true);
  });
});
