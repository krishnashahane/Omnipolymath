/**
 * Agent wallets: limited-budget, revocable spending authority with an
 * append-only, hash-chained audit trail. A wallet never holds real funds — it
 * authorizes spends against a budget that a payment tool must check first.
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

export type WalletPolicy = {
  /** Total budget for the wallet's lifetime, in minor units (cents). */
  budgetCents: number;
  /** Max single spend, in cents. */
  perTxLimitCents: number;
  /** Optional allowlist of merchants/payees. Empty = any. */
  allowedPayees?: string[];
  /** Absolute expiry (ms since epoch). */
  expiresAt?: number;
};

export type WalletEvent = {
  seq: number;
  at: number;
  kind: "issued" | "spend" | "denied" | "revoked" | "refund";
  amountCents?: number;
  payee?: string;
  memo?: string;
  prevHash: string;
  hash: string;
};

export type SpendResult =
  | { ok: true; remainingCents: number; event: WalletEvent }
  | { ok: false; reason: string; event: WalletEvent };

function chain(prevHash: string, body: Omit<WalletEvent, "hash" | "prevHash">): WalletEvent {
  const withPrev = { ...body, prevHash };
  return { ...withPrev, hash: createHash("sha256").update(JSON.stringify(withPrev)).digest("hex") };
}

export class AgentWallet {
  readonly id = randomUUID();
  private readonly secret = randomUUID();
  private spent = 0;
  private revoked = false;
  private readonly events: WalletEvent[] = [];

  constructor(
    readonly agentId: string,
    private readonly policy: WalletPolicy,
    private readonly now: () => number = Date.now,
  ) {
    if (!(policy.budgetCents >= 0 && policy.perTxLimitCents >= 0)) {
      throw new Error("wallet: budgets must be non-negative");
    }
    this.push({
      kind: "issued",
      amountCents: policy.budgetCents,
      memo: `per-tx ${policy.perTxLimitCents}`,
    });
  }

  /** Capability token handed to the agent. Revocation invalidates it instantly. */
  get token(): string {
    return `${this.id}.${createHash("sha256").update(`${this.id}:${this.secret}`).digest("hex").slice(0, 32)}`;
  }

  private push(body: Omit<WalletEvent, "hash" | "prevHash" | "seq" | "at">): WalletEvent {
    const event = chain(this.events.at(-1)?.hash ?? "0".repeat(64), {
      ...body,
      seq: this.events.length + 1,
      at: this.now(),
    });
    this.events.push(event);
    return event;
  }

  private tokenValid(token: string): boolean {
    const a = Buffer.from(token);
    const b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  spend(token: string, amountCents: number, payee: string, memo?: string): SpendResult {
    const deny = (reason: string): SpendResult => ({
      ok: false,
      reason,
      event: this.push({ kind: "denied", amountCents, payee, memo: reason }),
    });
    if (!this.tokenValid(token)) {
      return deny("invalid token");
    }
    if (this.revoked) {
      return deny("wallet revoked");
    }
    if (this.policy.expiresAt && this.now() > this.policy.expiresAt) {
      return deny("wallet expired");
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return deny("amount must be a positive integer of cents");
    }
    if (amountCents > this.policy.perTxLimitCents) {
      return deny("over per-transaction limit");
    }
    if (this.spent + amountCents > this.policy.budgetCents) {
      return deny("over remaining budget");
    }
    if (this.policy.allowedPayees?.length && !this.policy.allowedPayees.includes(payee)) {
      return deny("payee not allowed");
    }
    this.spent += amountCents;
    return {
      ok: true,
      remainingCents: this.remainingCents,
      event: this.push({ kind: "spend", amountCents, payee, memo }),
    };
  }

  refund(amountCents: number, payee: string): WalletEvent {
    const amount = Math.min(amountCents, this.spent);
    this.spent -= amount;
    return this.push({ kind: "refund", amountCents: amount, payee });
  }

  revoke(reason = "revoked by owner"): WalletEvent {
    this.revoked = true;
    return this.push({ kind: "revoked", memo: reason });
  }

  get remainingCents(): number {
    return this.revoked ? 0 : this.policy.budgetCents - this.spent;
  }

  get isRevoked(): boolean {
    return this.revoked;
  }

  audit(): readonly WalletEvent[] {
    return this.events;
  }
}

export function verifyWalletAudit(events: readonly WalletEvent[]): boolean {
  let prev = "0".repeat(64);
  for (const e of events) {
    const { hash, ...rest } = e;
    if (rest.prevHash !== prev) {
      return false;
    }
    if (createHash("sha256").update(JSON.stringify(rest)).digest("hex") !== hash) {
      return false;
    }
    prev = hash;
  }
  return true;
}
