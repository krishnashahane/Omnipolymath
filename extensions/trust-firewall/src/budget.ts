/**
 * Cost control: a per-day spend ledger with a hard cap, plus a model router
 * that sends routine prompts to a cheap model and hard ones to a strong model.
 *
 * Prices resolve in this order: operator `prices` config, exact rates learned
 * from the host's own per-response cost accounting, the built-in table in
 * prices.ts (copied from this repo's provider catalogs), then `defaultPrice`.
 * The ledger is persisted so a gateway restart does not reset today's spend.
 */
import fs from "node:fs";
import path from "node:path";
import { BUILTIN_PRICES, modelKeys, type ModelPrice } from "./prices.js";

export type { ModelPrice };

export type Usage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };

export type PriceSource = "config" | "host" | "builtin" | "default";

export type SpendEntry = {
  at: number;
  model: string;
  costUsd: number;
  runId?: string;
  priceSource?: PriceSource;
};

export function costOf(usage: Usage | undefined, price: ModelPrice): number {
  if (!usage) {
    return 0;
  }
  const n = (v: number | undefined) => (typeof v === "number" && v > 0 ? v : 0);
  const cacheRead = price.cacheReadPerMTok ?? price.inputPerMTok * 0.1;
  const cacheWrite = price.cacheWritePerMTok ?? price.inputPerMTok;
  return (
    (n(usage.input) * price.inputPerMTok +
      n(usage.output) * price.outputPerMTok +
      n(usage.cacheRead) * cacheRead +
      n(usage.cacheWrite) * cacheWrite) /
    1_000_000
  );
}

function dayKey(ms: number, timeZoneOffsetMinutes: number): string {
  return new Date(ms - timeZoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

const KEEP_MS = 3 * 86_400_000;

export class SpendLedger {
  private entries: SpendEntry[] = [];
  private readonly learned = new Map<string, ModelPrice>();

  constructor(
    private readonly dailyCapUsd: number,
    private readonly prices: Record<string, ModelPrice>,
    private readonly defaultPrice: ModelPrice,
    private readonly now: () => number = Date.now,
    private readonly tzOffsetMinutes = new Date().getTimezoneOffset(),
    private readonly file?: string,
  ) {
    if (file && fs.existsSync(file)) {
      const cutoff = this.now() - KEEP_MS;
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        try {
          const e = line ? (JSON.parse(line) as SpendEntry) : undefined;
          if (e && typeof e.at === "number" && typeof e.costUsd === "number" && e.at >= cutoff) {
            this.entries.push(e);
          }
        } catch {
          // Skip a torn final line.
        }
      }
      this.compactFile();
    }
  }

  private compactFile() {
    if (!this.file) {
      return;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, this.entries.map((e) => `${JSON.stringify(e)}\n`).join(""), {
      mode: 0o600,
    });
    fs.renameSync(tmp, this.file);
  }

  /** Remember exact rates the host computed for this model. */
  learn(model: string, price: ModelPrice | undefined) {
    if (price) {
      for (const key of modelKeys(model)) {
        this.learned.set(key, price);
      }
    }
  }

  resolvePrice(model: string): { price: ModelPrice; source: PriceSource } {
    const keys = modelKeys(model);
    for (const k of keys) {
      if (this.prices[k]) {
        return { price: this.prices[k], source: "config" };
      }
    }
    for (const k of keys) {
      const learned = this.learned.get(k);
      if (learned) {
        return { price: learned, source: "host" };
      }
    }
    for (const k of keys) {
      if (BUILTIN_PRICES[k]) {
        return { price: BUILTIN_PRICES[k], source: "builtin" };
      }
    }
    return { price: this.defaultPrice, source: "default" };
  }

  priceFor(model: string): ModelPrice {
    return this.resolvePrice(model).price;
  }

  record(model: string, usage: Usage | undefined, runId?: string): SpendEntry {
    const { price, source } = this.resolvePrice(model);
    const entry: SpendEntry = {
      at: this.now(),
      model,
      costUsd: costOf(usage, price),
      runId,
      priceSource: source,
    };
    this.entries.push(entry);
    const cutoff = this.now() - KEEP_MS;
    if (this.entries.length > 10_000 || this.entries[0]!.at < cutoff) {
      this.entries = this.entries.filter((e) => e.at >= cutoff).slice(-10_000);
      this.compactFile();
    } else if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    }
    return entry;
  }

  /** Add an already-priced cost (for example the firewall's own classifier calls). */
  recordCost(model: string, costUsd: number, runId?: string): SpendEntry | undefined {
    if (!(costUsd > 0) || !Number.isFinite(costUsd)) {
      return undefined;
    }
    const entry: SpendEntry = { at: this.now(), model, costUsd, runId, priceSource: "host" };
    this.entries.push(entry);
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    }
    return entry;
  }

  spentToday(): number {
    const today = dayKey(this.now(), this.tzOffsetMinutes);
    return this.entries
      .filter((e) => dayKey(e.at, this.tzOffsetMinutes) === today)
      .reduce((sum, e) => sum + e.costUsd, 0);
  }

  /** True when some of today's spend used the fallback default price. */
  estimatedToday(): boolean {
    const today = dayKey(this.now(), this.tzOffsetMinutes);
    return this.entries.some(
      (e) => e.priceSource === "default" && dayKey(e.at, this.tzOffsetMinutes) === today,
    );
  }

  spentForRun(runId: string): number {
    return this.entries.filter((e) => e.runId === runId).reduce((sum, e) => sum + e.costUsd, 0);
  }

  /** Remaining budget for today; Infinity when no cap is configured (cap <= 0). */
  remaining(): number {
    return this.dailyCapUsd > 0
      ? Math.max(0, this.dailyCapUsd - this.spentToday())
      : Number.POSITIVE_INFINITY;
  }

  capReached(): boolean {
    return this.dailyCapUsd > 0 && this.spentToday() >= this.dailyCapUsd;
  }

  get cap(): number {
    return this.dailyCapUsd;
  }
}

export type Complexity = "routine" | "hard";

const HARD_HINTS =
  /\b(architect|design|refactor|debug|prove|analy[sz]e|security|audit|migrat|optimi[sz]e|strategy|research|plan|why|trade-?offs?|complex|multi-step|reason)\b/i;
const ROUTINE_HINTS =
  /\b(remind|summari[sz]e|translate|rename|list|what time|weather|convert|format|spell|define|hi|hello|thanks|schedule|add to)\b/i;

/** Cheap, deterministic triage. Long, code-heavy or analytical prompts are "hard". */
export function classifyPrompt(prompt: string, attachments = 0): Complexity {
  const text = prompt.trim();
  let score = 0;
  if (text.length > 1_200) {
    score += 2;
  } else if (text.length > 400) {
    score += 1;
  }
  if (/```|\bfunction\b|\bclass\b|=>|#include|SELECT\s+.+\s+FROM/i.test(text)) {
    score += 2;
  }
  if (HARD_HINTS.test(text)) {
    score += 2;
  }
  if (ROUTINE_HINTS.test(text) && text.length < 200) {
    score -= 2;
  }
  if (attachments > 0) {
    score += 1;
  }
  if ((text.match(/\?/g) ?? []).length >= 3) {
    score += 1;
  }
  return score >= 2 ? "hard" : "routine";
}
