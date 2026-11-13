/**
 * Cross-agent handoff protocol.
 *
 * A handoff is a signed envelope (Ed25519) that says: "agent A delegates task T
 * to agent B, with exactly these capabilities, this budget, until this time".
 * The receiver verifies the signature, the audience, the expiry, that the nonce
 * was never seen before (replay protection), and that every requested
 * capability is inside the delegated scope. Delegations can be chained, and a
 * child can only ever narrow — never widen — what its parent granted.
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

export type Capability = string; // e.g. "calendar:read", "email:send:to=team@acme.com"

export type HandoffClaims = {
  v: 1;
  id: string;
  issuer: string;
  audience: string;
  task: string;
  capabilities: Capability[];
  budgetCents: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  /** id of the parent envelope when this is a re-delegation. */
  parent?: string;
};

export type HandoffEnvelope = { claims: HandoffClaims; signature: string; publicKey: string };

export type AgentIdentity = {
  id: string;
  publicKey: KeyObject;
  privateKey: KeyObject;
  publicKeyPem: string;
};

export function createIdentity(id: string): AgentIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    id,
    publicKey,
    privateKey,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

export function identityFromPem(id: string, privatePem: string): AgentIdentity {
  const privateKey = createPrivateKey(privatePem);
  const publicKey = createPublicKey(privateKey);
  return {
    id,
    publicKey,
    privateKey,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/** Deterministic serialization so signatures don't depend on key order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .toSorted()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** "a:b" covers "a:b" and "a:b:anything"; "a:*" covers "a:anything". */
export function covers(granted: Capability, requested: Capability): boolean {
  if (granted === requested) {
    return true;
  }
  if (granted.endsWith(":*")) {
    return requested.startsWith(granted.slice(0, -1));
  }
  return requested.startsWith(`${granted}:`);
}

export function issueHandoff(
  from: AgentIdentity,
  to: string,
  task: string,
  capabilities: Capability[],
  opts: { budgetCents?: number; ttlMs?: number; parent?: HandoffEnvelope; now?: number } = {},
): HandoffEnvelope {
  const now = opts.now ?? Date.now();
  if (opts.parent) {
    const p = opts.parent.claims;
    if (p.audience !== from.id) {
      throw new Error("handoff: can only re-delegate an envelope addressed to you");
    }
    const widened = capabilities.filter((c) => !p.capabilities.some((g) => covers(g, c)));
    if (widened.length) {
      throw new Error(`handoff: cannot widen scope (${widened.join(", ")})`);
    }
    if ((opts.budgetCents ?? 0) > p.budgetCents) {
      throw new Error("handoff: child budget exceeds parent");
    }
  }
  const parentExpiry = opts.parent?.claims.expiresAt ?? Number.POSITIVE_INFINITY;
  const claims: HandoffClaims = {
    v: 1,
    id: randomUUID(),
    issuer: from.id,
    audience: to,
    task,
    capabilities: [...new Set(capabilities)].toSorted(),
    budgetCents: opts.budgetCents ?? 0,
    issuedAt: now,
    expiresAt: Math.min(now + (opts.ttlMs ?? 15 * 60_000), parentExpiry),
    nonce: randomUUID(),
    parent: opts.parent?.claims.id,
  };
  const signature = sign(null, Buffer.from(canonical(claims)), from.privateKey).toString("base64");
  return { claims, signature, publicKey: from.publicKeyPem };
}

export type VerifyResult = { ok: true; claims: HandoffClaims } | { ok: false; reason: string };

export class HandoffVerifier {
  private readonly seen = new Map<string, number>();

  /** trustedIssuers: agent id -> PEM public key. Unknown issuers are rejected. */
  constructor(
    private readonly self: string,
    private readonly trustedIssuers: Record<string, string>,
    private readonly now: () => number = Date.now,
  ) {}

  verify(env: HandoffEnvelope, requested: Capability[] = []): VerifyResult {
    const c = env.claims;
    const pinned = this.trustedIssuers[c.issuer];
    if (!pinned) {
      return { ok: false, reason: "untrusted issuer" };
    }
    if (pinned.trim() !== env.publicKey.trim()) {
      return { ok: false, reason: "issuer key mismatch" };
    }
    let valid: boolean;
    try {
      valid = verify(
        null,
        Buffer.from(canonical(c)),
        createPublicKey(pinned),
        Buffer.from(env.signature, "base64"),
      );
    } catch {
      valid = false;
    }
    if (!valid) {
      return { ok: false, reason: "bad signature" };
    }
    if (c.v !== 1) {
      return { ok: false, reason: "unsupported version" };
    }
    if (c.audience !== this.self) {
      return { ok: false, reason: "wrong audience" };
    }
    const t = this.now();
    if (c.issuedAt > t + 60_000) {
      return { ok: false, reason: "issued in the future" };
    }
    if (c.expiresAt <= t) {
      return { ok: false, reason: "expired" };
    }
    for (const [nonce, exp] of this.seen) {
      if (exp <= t) {
        this.seen.delete(nonce);
      }
    }
    if (this.seen.has(c.nonce)) {
      return { ok: false, reason: "replayed" };
    }
    const outside = requested.filter((r) => !c.capabilities.some((g) => covers(g, r)));
    if (outside.length) {
      return { ok: false, reason: `capability not granted: ${outside.join(", ")}` };
    }
    this.seen.set(c.nonce, c.expiresAt);
    return { ok: true, claims: c };
  }
}
