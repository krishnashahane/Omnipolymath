/**
 * Self-cleaning, injection-aware memory exposed to agents as two tools.
 *
 * - `fact_save` stores a fact with provenance. Facts saved during a run that
 *   read likely prompt-injection content are stored at low confidence and
 *   marked `tainted`, so they decay out instead of becoming permanent.
 * - `fact_search` recalls the strongest live facts.
 *
 * The store sweeps itself (expiry, decay, duplicates, contradictions) on load
 * and after every write, and is persisted with an integrity digest per fact.
 */
import fs from "node:fs";
import path from "node:path";
import { LivingMemory, type MemoryFact } from "./memory.js";

export type MemoryToolsOptions = {
  file?: string;
  halfLifeDays: number;
  minConfidence: number;
  maxFacts: number;
  isTainted: (runId?: string) => boolean;
};

const TAINTED_CONFIDENCE = 0.3;
const NORMAL_CONFIDENCE = 0.8;

export class FactStore {
  readonly memory: LivingMemory;

  constructor(private readonly opts: MemoryToolsOptions) {
    this.memory = new LivingMemory({
      halfLifeMs: opts.halfLifeDays * 86_400_000,
      minConfidence: opts.minConfidence,
      maxFacts: opts.maxFacts,
    });
    if (opts.file && fs.existsSync(opts.file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(opts.file, "utf8")) as { facts?: MemoryFact[] };
        this.memory.load(raw.facts ?? []);
      } catch {
        // A corrupt store starts empty; the old file is kept beside it for inspection.
        fs.copyFileSync(opts.file, `${opts.file}.corrupt-${Date.now()}`);
      }
      this.memory.sweep();
    }
  }

  private persist() {
    if (!this.opts.file) {
      return;
    }
    fs.mkdirSync(path.dirname(this.opts.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.opts.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, facts: this.memory.export() }), {
      mode: 0o600,
    });
    fs.renameSync(tmp, this.opts.file);
  }

  save(input: { key: string; value: string; ttlDays?: number; agentId?: string; runId?: string }) {
    const tainted = this.opts.isTainted(input.runId);
    const source = `${tainted ? "tainted" : "agent"}:${input.agentId ?? "default"}`;
    const fact = this.memory.remember(
      input.key,
      input.value,
      source,
      tainted ? TAINTED_CONFIDENCE : NORMAL_CONFIDENCE,
      input.ttlDays ? input.ttlDays * 86_400_000 : undefined,
    );
    const sweep = this.memory.sweep();
    this.persist();
    return { fact, tainted, sweep };
  }

  search(query: string, limit = 10) {
    return this.memory.search(query, limit);
  }
}

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  details: value,
});

function str(v: unknown, field: string, max: number): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`${field} is required`);
  }
  if (v.length > max) {
    throw new Error(`${field} must be at most ${max} characters`);
  }
  return v.trim();
}

/** Tool definitions; `ctx` comes from the host's tool factory. */
export function createFactTools(store: FactStore, ctx: { agentId?: string; runId?: string }) {
  return [
    {
      name: "fact_save",
      label: "Save fact",
      description:
        "Save a durable fact (preference, decision, account detail) to self-cleaning memory. Re-saving the same value confirms it; a new value for the same key supersedes the old one. Facts saved after reading untrusted content are kept at low confidence.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["key", "value"],
        properties: {
          key: { type: "string", minLength: 1, maxLength: 200, description: "Short topic key" },
          value: { type: "string", minLength: 1, maxLength: 4000 },
          ttlDays: { type: "number", minimum: 1, maximum: 3650, description: "Optional expiry" },
        },
      },
      async execute(_id: string, args: Record<string, unknown>) {
        const ttl = typeof args.ttlDays === "number" ? args.ttlDays : undefined;
        const result = store.save({
          key: str(args.key, "key", 200),
          value: str(args.value, "value", 4000),
          ttlDays: ttl,
          agentId: ctx.agentId,
          runId: ctx.runId,
        });
        return text({
          saved: result.fact.key,
          confidence: result.fact.confidence,
          tainted: result.tainted,
          note: result.tainted
            ? "Stored at low confidence because this run read content that looked like a prompt injection."
            : undefined,
          sweep: result.sweep,
        });
      },
    },
    {
      name: "fact_search",
      label: "Search facts",
      description:
        "Look up facts saved with fact_save. Returns only facts that are still trustworthy (not expired, decayed or superseded), strongest first, with their source.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1, maxLength: 200 },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
      },
      async execute(_id: string, args: Record<string, unknown>) {
        const limit = typeof args.limit === "number" ? Math.min(50, Math.max(1, args.limit)) : 10;
        const hits = store.search(str(args.query, "query", 200), limit);
        return text(
          hits.map((f) => ({
            key: f.key,
            value: f.value,
            source: f.source,
            confidence: Number(f.effective.toFixed(3)),
            savedAt: new Date(f.createdAt).toISOString(),
          })),
        );
      },
    },
  ];
}
