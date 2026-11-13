/**
 * Wires agent wallets into tool calls.
 *
 * Every spend-tier tool call that names an amount is charged against a
 * per-agent, per-day wallet before it can run. Over-limit or disallowed-payee
 * calls are blocked; calls a human later denies are refunded. The wallet is an
 * authorization ledger — it does not move money itself; the payment tool does,
 * and only after the firewall has let the call through.
 */
import { AgentWallet, type WalletEvent } from "./wallet.js";

export type WalletLimits = {
  perTransactionUsd: number;
  dailyUsd: number;
  allowedPayees: string[];
};

export type SpendIntent = { amountCents: number; payee: string; currency: string };

const AMOUNT_KEYS = ["amount", "amountUsd", "amount_usd", "total", "price", "value", "cost"];
const CENT_KEYS = ["amountCents", "amount_cents", "totalCents", "total_cents"];
const PAYEE_KEYS = ["payee", "merchant", "recipient", "to", "vendor", "seller", "account"];

function money(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,\s]|usd/gi, "");
    if (/^\d+(\.\d+)?$/.test(cleaned)) {
      return Number(cleaned);
    }
  }
  return undefined;
}

/** Find the amount a spend call is about to move. Undefined when it names none. */
export function spendIntent(params: Record<string, unknown>): SpendIntent | undefined {
  let cents: number | undefined;
  for (const k of CENT_KEYS) {
    const v = money(params[k]);
    if (v !== undefined) {
      cents = Math.round(v);
      break;
    }
  }
  if (cents === undefined) {
    for (const k of AMOUNT_KEYS) {
      const v = money(params[k]);
      if (v !== undefined) {
        cents = Math.round(v * 100);
        break;
      }
    }
  }
  if (cents === undefined) {
    return undefined;
  }
  const payee =
    PAYEE_KEYS.map((k) => params[k]).find(
      (v): v is string => typeof v === "string" && v.length > 0,
    ) ?? "unknown";
  const currency = typeof params.currency === "string" ? params.currency.toUpperCase() : "USD";
  return { amountCents: cents, payee, currency };
}

export type WalletCheck =
  | { ok: true; event: WalletEvent; release: () => void }
  | { ok: false; reason: string };

export class WalletGuard {
  private readonly wallets = new Map<string, AgentWallet>();

  constructor(
    private readonly limits: WalletLimits,
    private readonly now: () => number = Date.now,
  ) {}

  private wallet(agentId: string): AgentWallet {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const key = `${agentId}\u0000${day}`;
    let w = this.wallets.get(key);
    if (!w) {
      w = new AgentWallet(
        agentId,
        {
          budgetCents: Math.round(this.limits.dailyUsd * 100),
          perTxLimitCents: Math.round(this.limits.perTransactionUsd * 100),
          allowedPayees: this.limits.allowedPayees,
        },
        this.now,
      );
      this.wallets.set(key, w);
      for (const k of this.wallets.keys()) {
        if (!k.endsWith(day)) {
          this.wallets.delete(k);
        }
      }
    }
    return w;
  }

  /** Reserve the amount. Call `release()` if the action ends up not running. */
  check(agentId: string | undefined, intent: SpendIntent): WalletCheck {
    if (intent.currency !== "USD") {
      return {
        ok: false,
        reason: `wallet limits are in USD; ${intent.currency} amounts are blocked until converted`,
      };
    }
    const w = this.wallet(agentId ?? "default");
    const result = w.spend(w.token, intent.amountCents, intent.payee);
    if (!result.ok) {
      return { ok: false, reason: `wallet: ${result.reason}` };
    }
    let released = false;
    return {
      ok: true,
      event: result.event,
      release: () => {
        if (!released) {
          released = true;
          w.refund(intent.amountCents, intent.payee);
        }
      },
    };
  }

  remainingUsd(agentId?: string): number {
    return this.wallet(agentId ?? "default").remainingCents / 100;
  }
}
