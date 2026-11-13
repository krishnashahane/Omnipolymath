import { expect, test } from "vitest";
import { fingerprint } from "../../packages/omnipolymath-id-protocol/src/index.js";
import { buildWorld } from "../../packages/omnipolymath-id-protocol/src/testing/world.js";
import { normalizeGatewayConfig } from "./config-shared.js";
import { dialableNodeHostOmnipolymathIdTarget } from "./omnipolymath-id-target.js";

const world = await buildWorld();
const target = {
  hostname: world.binding.body.hostname,
  pin: {
    claw_id: world.binding.body.claw_id,
    root_fp: await fingerprint(world.rootPub),
    binding_seq: 1,
  },
  evidence: { root_pub: world.rootPub, binding: world.binding },
  relayUrl: "https://relay.example/",
};
const normalize = (discoveryUrl?: string) =>
  normalizeGatewayConfig({
    kind: "omnipolymath-id",
    omnipolymathId: { ...target, ...(discoveryUrl === undefined ? {} : { discoveryUrl }) },
  });

test("saved target retains independent Discovery routing without inferring an origin", () => {
  const legacy = normalize()?.omnipolymathId;
  expect(legacy?.discoveryUrl).toBeUndefined();
  expect(() => dialableNodeHostOmnipolymathIdTarget(legacy!)).toThrow("Discovery origin");
  expect(normalize("https://discovery.example/")?.omnipolymathId?.discoveryUrl).toBe(
    "https://discovery.example",
  );
  expect(normalize("http://localhost:8787/")?.omnipolymathId?.discoveryUrl).toBe(
    "http://localhost:8787",
  );
});

test.each([
  "http://remote.example",
  // Built at runtime so secret scanners do not mistake the synthetic userinfo for a credential.
  Object.assign(new URL("https://api.example"), { username: "user", password: "fixture" }).href,
  "https://api.example/path",
  "https://api.example/?q=1",
  "https://api.example/#x",
])("rejects non-origin Discovery routing %s", (url) => {
  expect(() => normalize(url)).toThrow("Discovery origin");
});

test("saved freshness keeps the K_gw its snapshot order belongs to", () => {
  const marker = { seq: 3, issued_at: 1, binding_seq: 1, k_gw: world.gateway.pub };
  const saved = normalizeGatewayConfig({
    kind: "omnipolymath-id",
    omnipolymathId: { ...target, freshness: { claw_id: target.pin.claw_id, snapshot: marker } },
  })?.omnipolymathId;
  expect(saved?.freshness?.snapshot).toEqual(marker);
  expect(() =>
    normalizeGatewayConfig({
      kind: "omnipolymath-id",
      omnipolymathId: {
        ...target,
        freshness: { claw_id: target.pin.claw_id, snapshot: { ...marker, k_gw: "nope" as never } },
      },
    }),
  ).toThrow("freshness");
});

test("a saved high-water above the pinned binding is capped on load (J5)", () => {
  const saved = normalizeGatewayConfig({
    kind: "omnipolymath-id",
    omnipolymathId: {
      ...target,
      freshness: {
        claw_id: target.pin.claw_id,
        snapshot: { seq: 3, issued_at: 1, binding_seq: 50 },
      },
    },
  })?.omnipolymathId;
  expect(saved?.freshness?.snapshot?.binding_seq).toBe(1);
});
