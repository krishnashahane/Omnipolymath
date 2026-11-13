/**
 * Built-in list prices (USD per million tokens), copied from the provider
 * catalogs bundled in this repository (extensions/anthropic-vertex,
 * extensions/amazon-bedrock-mantle, extensions/vercel-ai-gateway,
 * extensions/arcee). Only exact model ids are listed; nothing is guessed.
 *
 * At runtime the firewall prefers, in order: operator `prices` config, rates
 * learned from the host's own per-response cost accounting, this table, and
 * finally `defaultPrice`.
 */
export type ModelPrice = {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
};

const p = (
  inputPerMTok: number,
  outputPerMTok: number,
  cacheReadPerMTok?: number,
  cacheWritePerMTok?: number,
): ModelPrice => ({ inputPerMTok, outputPerMTok, cacheReadPerMTok, cacheWritePerMTok });

export const BUILTIN_PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  "claude-fable-5": p(10, 50, 1, 12.5),
  "claude-mythos-5": p(10, 50, 1, 12.5),
  "claude-opus-5": p(5, 25, 0.5, 6.25),
  "claude-sonnet-5": p(2, 10, 0.2, 2.5),
  "claude-opus-4-8": p(5, 25, 0.5, 6.25),
  "claude-opus-4-7": p(5, 25, 0.5, 6.25),
  "claude-opus-4-6": p(5, 25, 0.5, 6.25),
  "claude-opus-4.6": p(5, 25, 0.5, 6.25),
  "claude-sonnet-4-6": p(3, 15, 0.3, 3.75),
  "gpt-5.4": p(2.5, 15, 0.25),
  "gpt-5.4-pro": p(30, 180),
  "kimi-k2.6": p(0.95, 4, 0.16),
  "trinity-large-preview": p(0.25, 1, 0.25, 0.25),
  "trinity-large-thinking": p(0.25, 0.9, 0.25, 0.25),
  "trinity-mini": p(0.045, 0.15, 0.045, 0.045),
});

/** Strip provider prefixes such as `anthropic/`, `openai/` or `anthropic.`. */
export function modelKeys(model: string): string[] {
  const keys = [model];
  const slash = model.split("/").pop();
  if (slash && slash !== model) {
    keys.push(slash);
  }
  const dotted = /^[a-z0-9-]+\.(claude-.+)$/i.exec(slash ?? model)?.[1];
  if (dotted) {
    keys.push(dotted);
  }
  return keys;
}

type Bucket = { tokens: number; cost: number };

/**
 * Derive exact per-token rates from an assistant message whose usage carries
 * the host-computed cost breakdown (`usage.cost.{input,output,cacheRead,cacheWrite}`).
 */
export function ratesFromAssistant(message: unknown): ModelPrice | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const usage = (message as { usage?: unknown }).usage as Record<string, unknown> | undefined;
  const cost = usage?.cost as Record<string, unknown> | undefined;
  if (!usage || !cost) {
    return undefined;
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  const bucket = (t: string, c: string): Bucket => ({
    tokens: num(usage[t]),
    cost: num(cost[c]),
  });
  const rate = (b: Bucket) => (b.tokens > 0 ? (b.cost / b.tokens) * 1_000_000 : undefined);
  const input = rate(bucket("input", "input"));
  const output = rate(bucket("output", "output"));
  if (input === undefined || output === undefined) {
    return undefined;
  }
  if (input === 0 && output === 0 && num(cost.total) === 0) {
    // Free/local models report zero cost; trust it only with a positive token count.
    return { inputPerMTok: 0, outputPerMTok: 0, cacheReadPerMTok: 0, cacheWritePerMTok: 0 };
  }
  return {
    inputPerMTok: input,
    outputPerMTok: output,
    cacheReadPerMTok: rate(bucket("cacheRead", "cacheRead")),
    cacheWritePerMTok: rate(bucket("cacheWrite", "cacheWrite")),
  };
}
