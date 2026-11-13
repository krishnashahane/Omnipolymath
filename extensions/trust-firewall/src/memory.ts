/**
 * Memory that doesn't rot.
 *
 * Each fact carries provenance (source + content hash), a confidence that
 * decays over time, and an optional expiry. `sweep()` drops expired and
 * low-confidence facts, merges duplicates, and resolves contradictions in
 * favour of the newest, best-sourced fact — so the store stays small, current
 * and verifiable instead of growing stale forever.
 */
import { createHash } from "node:crypto";

export type MemoryFact = {
  key: string;
  value: string;
  source: string;
  /** SHA-256 of key+value+source. Lets anyone verify the fact was not edited. */
  digest: string;
  createdAt: number;
  confirmedAt: number;
  /** 0..1 at confirmation time. */
  confidence: number;
  expiresAt?: number;
  /** Facts that were superseded by this one. */
  supersedes: string[];
};

export type MemoryOptions = {
  /** Confidence half-life in ms (default 30 days). */
  halfLifeMs?: number;
  /** Facts below this effective confidence are dropped on sweep (default 0.2). */
  minConfidence?: number;
  /** Hard cap on facts kept (default 2,000). */
  maxFacts?: number;
  now?: () => number;
};

export type SweepReport = {
  expired: number;
  decayed: number;
  merged: number;
  superseded: number;
  kept: number;
};

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
export const factDigest = (key: string, value: string, source: string) =>
  createHash("sha256")
    .update(`${normalize(key)}\u0000${value}\u0000${source}`)
    .digest("hex");

export class LivingMemory {
  private readonly facts = new Map<string, MemoryFact[]>();
  private readonly halfLife: number;
  private readonly minConfidence: number;
  private readonly maxFacts: number;
  private readonly now: () => number;

  constructor(opts: MemoryOptions = {}) {
    this.halfLife = opts.halfLifeMs ?? 30 * 86_400_000;
    this.minConfidence = opts.minConfidence ?? 0.2;
    this.maxFacts = opts.maxFacts ?? 2_000;
    this.now = opts.now ?? Date.now;
  }

  effectiveConfidence(f: MemoryFact): number {
    const age = Math.max(0, this.now() - f.confirmedAt);
    return f.confidence * 0.5 ** (age / this.halfLife);
  }

  remember(
    key: string,
    value: string,
    source: string,
    confidence = 0.8,
    ttlMs?: number,
  ): MemoryFact {
    const k = normalize(key);
    const t = this.now();
    const list = this.facts.get(k) ?? [];
    const digest = factDigest(k, value, source);
    const same = list.find((f) => normalize(f.value) === normalize(value));
    if (same) {
      // Re-confirmation refreshes the fact instead of duplicating it.
      same.confirmedAt = t;
      same.confidence = Math.min(1, Math.max(same.confidence, confidence) + 0.05);
      if (ttlMs) {
        same.expiresAt = t + ttlMs;
      }
      return same;
    }
    const fact: MemoryFact = {
      key: k,
      value,
      source,
      digest,
      createdAt: t,
      confirmedAt: t,
      confidence: Math.max(0, Math.min(1, confidence)),
      expiresAt: ttlMs ? t + ttlMs : undefined,
      supersedes: [],
    };
    list.push(fact);
    this.facts.set(k, list);
    return fact;
  }

  /** Current best answer for a key, or undefined if nothing trustworthy remains. */
  recall(key: string): (MemoryFact & { effective: number }) | undefined {
    const live = (this.facts.get(normalize(key)) ?? [])
      .filter((f) => !f.expiresAt || f.expiresAt > this.now())
      .map((f) => Object.assign({}, f, { effective: this.effectiveConfidence(f) }))
      .filter((f) => f.effective >= this.minConfidence)
      .toSorted((a, b) => b.effective - a.effective || b.confirmedAt - a.confirmedAt);
    return live[0];
  }

  verify(f: MemoryFact): boolean {
    return factDigest(f.key, f.value, f.source) === f.digest;
  }

  sweep(): SweepReport {
    const report: SweepReport = { expired: 0, decayed: 0, merged: 0, superseded: 0, kept: 0 };
    const t = this.now();
    for (const [k, list] of this.facts) {
      let kept = list.filter((f) => {
        // Tampered facts never survive.
        if (!this.verify(f)) {
          return false;
        }
        if (f.expiresAt && f.expiresAt <= t) {
          report.expired++;
          return false;
        }
        if (this.effectiveConfidence(f) < this.minConfidence) {
          report.decayed++;
          return false;
        }
        return true;
      });
      // Contradictions: one key, several values -> keep the strongest, record lineage.
      if (kept.length > 1) {
        kept = kept.toSorted(
          (a, b) =>
            this.effectiveConfidence(b) - this.effectiveConfidence(a) ||
            b.confirmedAt - a.confirmedAt,
        );
        const [winner, ...losers] = kept;
        winner!.supersedes = [
          ...new Set([...winner!.supersedes, ...losers.map((l) => l.digest)]),
        ].slice(-20);
        report.superseded += losers.length;
        kept = [winner!];
      }
      if (kept.length) {
        this.facts.set(k, kept);
      } else {
        this.facts.delete(k);
      }
    }
    // Bound total size by evicting the weakest facts.
    const all = [...this.facts.values()].flat();
    if (all.length > this.maxFacts) {
      const weakestFirst = all.toSorted(
        (a, b) => this.effectiveConfidence(a) - this.effectiveConfidence(b),
      );
      for (const f of weakestFirst.slice(0, all.length - this.maxFacts)) {
        const list = this.facts.get(f.key)!.filter((x) => x !== f);
        if (list.length) {
          this.facts.set(f.key, list);
        } else {
          this.facts.delete(f.key);
        }
        report.decayed++;
      }
    }
    report.kept = [...this.facts.values()].reduce((n, l) => n + l.length, 0);
    return report;
  }

  /** Every stored fact (for persistence). */
  export(): MemoryFact[] {
    return [...this.facts.values()].flat().map((f) => structuredClone(f));
  }

  /** Load facts saved by `export()`. Tampered facts are dropped. */
  load(facts: readonly MemoryFact[]): number {
    let loaded = 0;
    for (const f of facts) {
      if (!f || typeof f.key !== "string" || typeof f.value !== "string" || !this.verify(f)) {
        continue;
      }
      const list = this.facts.get(f.key) ?? [];
      list.push({ ...f, supersedes: Array.isArray(f.supersedes) ? [...f.supersedes] : [] });
      this.facts.set(f.key, list);
      loaded++;
    }
    return loaded;
  }

  /** Keys whose best fact matches `query` (case-insensitive substring), strongest first. */
  search(query: string, limit = 10): Array<MemoryFact & { effective: number }> {
    const q = normalize(query);
    const out: Array<MemoryFact & { effective: number }> = [];
    for (const key of this.facts.keys()) {
      const best = this.recall(key);
      if (best && (key.includes(q) || normalize(best.value).includes(q))) {
        out.push(best);
      }
    }
    return out.toSorted((a, b) => b.effective - a.effective).slice(0, limit);
  }

  forget(key: string): boolean {
    return this.facts.delete(normalize(key));
  }

  size(): number {
    return [...this.facts.values()].reduce((n, l) => n + l.length, 0);
  }
}
