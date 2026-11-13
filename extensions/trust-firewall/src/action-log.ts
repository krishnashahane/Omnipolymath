/**
 * Replayable, tamper-evident action log.
 *
 * Every decision the firewall makes is appended as one JSON line. Each entry
 * carries the SHA-256 of the previous entry, so editing or deleting any line
 * breaks the chain and `verifyChain` reports exactly where.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RiskTier } from "./risk.js";
import type { FileSnapshot } from "./snapshots.js";

export type UndoInfo = { kind: "restore-files"; files: FileSnapshot[] };

export type ActionDecision = "allowed" | "approval" | "blocked" | "dry-run";

export type ActionEntry = {
  id: string;
  seq: number;
  at: string;
  runId?: string;
  agentId?: string;
  toolName: string;
  tier: RiskTier;
  decision: ActionDecision;
  reasons: string[];
  /** Redacted, size-bounded copy of the parameters so the action can be replayed. */
  params: Record<string, unknown>;
  /** How to undo this call: the files it touched, as they were before it ran. */
  undo?: UndoInfo;
  outcome?: { ok: boolean; error?: string; durationMs?: number };
  prevHash: string;
  hash: string;
};

const GENESIS = "0".repeat(64);
const SECRET_KEY =
  /(pass(word)?|secret|token|api[_-]?key|authorization|cookie|private[_-]?key|credential|session)/i;
const MAX_STRING = 2_000;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return "[depth]";
  }
  if (typeof value === "string") {
    const masked = value
      .replace(/\b(sk|pk|rk|ghp|gho|ghs|xox[abp]|AKIA)[-_A-Za-z0-9]{12,}\b/g, "[redacted-key]")
      .replace(
        /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
        "[redacted-jwt]",
      );
    return masked.length > MAX_STRING
      ? `${masked.slice(0, MAX_STRING)}…[+${masked.length - MAX_STRING}]`
      : masked;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redact(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value).slice(0, 50)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function hashEntry(entry: Omit<ActionEntry, "hash">): string {
  return createHash("sha256").update(JSON.stringify(entry)).digest("hex");
}

export class ActionLog {
  private entries: ActionEntry[] = [];
  private lastHash = GENESIS;
  private seq = 0;

  constructor(
    private readonly file?: string,
    private readonly maxInMemory = 5_000,
  ) {
    if (file && fs.existsSync(file)) {
      const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      for (const line of lines.slice(-maxInMemory)) {
        try {
          this.entries.push(JSON.parse(line) as ActionEntry);
        } catch {
          // A corrupt line is surfaced by verifyChain; keep loading the rest.
        }
      }
      const last = this.entries.at(-1);
      if (last) {
        this.lastHash = last.hash;
        this.seq = last.seq;
      }
    }
  }

  append(input: Omit<ActionEntry, "id" | "seq" | "at" | "prevHash" | "hash">): ActionEntry {
    const base = {
      ...input,
      params: redact(input.params) as Record<string, unknown>,
      // Snapshot metadata is firewall-owned (paths + hashes), so it is stored as is.
      undo: input.undo
        ? { kind: input.undo.kind, files: input.undo.files.map((f) => ({ ...f })) }
        : undefined,
      id: randomUUID(),
      seq: ++this.seq,
      at: new Date().toISOString(),
      prevHash: this.lastHash,
    };
    const entry: ActionEntry = { ...base, hash: hashEntry(base) };
    this.lastHash = entry.hash;
    this.entries.push(entry);
    if (this.entries.length > this.maxInMemory) {
      this.entries.splice(0, this.entries.length - this.maxInMemory);
    }
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    }
    return entry;
  }

  /** Attach the real outcome once the tool finished. Outcomes are a separate chained entry. */
  recordOutcome(
    entryId: string,
    outcome: NonNullable<ActionEntry["outcome"]>,
    undo?: UndoInfo,
  ): ActionEntry | undefined {
    const original = this.entries.find((e) => e.id === entryId);
    if (!original) {
      return undefined;
    }
    return this.append({
      runId: original.runId,
      agentId: original.agentId,
      toolName: original.toolName,
      tier: original.tier,
      decision: original.decision,
      reasons: [`outcome-of:${original.id}`],
      params: {},
      outcome,
      undo,
    });
  }

  /** Look an entry up by id (in-memory window). */
  get(entryId: string): ActionEntry | undefined {
    return this.entries.find((e) => e.id === entryId);
  }

  list(filter: { runId?: string; limit?: number } = {}): ActionEntry[] {
    const rows = filter.runId ? this.entries.filter((e) => e.runId === filter.runId) : this.entries;
    return rows.slice(-(filter.limit ?? rows.length));
  }

  /** Ordered list of calls that ran, ready to be replayed (dry-run first!). */
  replayPlan(runId: string): Array<Pick<ActionEntry, "toolName" | "params">> {
    return this.entries
      .filter(
        (e) =>
          e.runId === runId &&
          (e.decision === "allowed" || e.decision === "approval") &&
          !e.outcome,
      )
      .map((e) => ({ toolName: e.toolName, params: e.params }));
  }

  /** Files to put back for a run, newest change first. */
  undoPlan(runId: string): FileSnapshot[] {
    return undoPlanFor(this.entries, runId);
  }

  /** Run ids that have something to undo, newest first. */
  undoableRuns(limit = 20): string[] {
    const ids: string[] = [];
    for (const e of this.entries.toReversed()) {
      if (e.runId && e.undo?.files.length && !ids.includes(e.runId)) {
        ids.push(e.runId);
      }
      if (ids.length >= limit) {
        break;
      }
    }
    return ids;
  }
}

export type ChainReport = { ok: boolean; checked: number; brokenAt?: number; reason?: string };

export function verifyChain(entries: readonly ActionEntry[]): ChainReport {
  let prev = entries[0]?.prevHash ?? GENESIS;
  for (const [index, entry] of entries.entries()) {
    const { hash, ...rest } = entry;
    if (entry.prevHash !== prev) {
      return {
        ok: false,
        checked: index,
        brokenAt: entry.seq,
        reason: "prevHash mismatch (entry removed or reordered)",
      };
    }
    if (hashEntry(rest) !== hash) {
      return {
        ok: false,
        checked: index,
        brokenAt: entry.seq,
        reason: "hash mismatch (entry edited)",
      };
    }
    prev = hash;
  }
  return { ok: true, checked: entries.length };
}

/**
 * Collect the undo snapshots of a run. When an outcome entry carries settled
 * snapshots (with the post-write hash), those replace the pre-call ones.
 */
export function undoPlanFor(entries: readonly ActionEntry[], runId: string): FileSnapshot[] {
  const order: string[] = [];
  const byCall = new Map<string, FileSnapshot[]>();
  for (const e of entries) {
    if (e.runId !== runId || !e.undo?.files.length) {
      continue;
    }
    const ref = e.reasons.find((r) => r.startsWith("outcome-of:"));
    const callId = ref ? ref.slice("outcome-of:".length) : e.id;
    if (!byCall.has(callId)) {
      order.push(callId);
    }
    byCall.set(callId, e.undo.files);
  }
  return order.toReversed().flatMap((id) => byCall.get(id)!.toReversed());
}

/** Read every entry of a log file (CLI use; the gateway keeps a bounded window). */
export function readLogFile(file: string): ActionEntry[] {
  if (!fs.existsSync(file)) {
    return [];
  }
  const out: ActionEntry[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) {
      continue;
    }
    try {
      out.push(JSON.parse(line) as ActionEntry);
    } catch {
      // verifyChain reports corrupt lines.
    }
  }
  return out;
}
