/**
 * Proof of work: every run ends with a short receipt — what it did, what it
 * cost, what changed, and what the firewall stopped.
 */
import { createHash } from "node:crypto";
import type { ActionEntry } from "./action-log.js";

export type Receipt = {
  runId: string;
  agentId?: string;
  finishedAt: string;
  success: boolean;
  durationMs?: number;
  costUsd: number;
  actions: { allowed: number; approved: number; blocked: number; dryRun: number };
  tools: string[];
  changed: string[];
  blocked: Array<{ toolName: string; reason: string }>;
  tainted: boolean;
  /** Hash of the last action-log entry covered by this receipt (links receipt to log). */
  logHead?: string;
  digest: string;
};

const PATH_KEYS = ["path", "file", "file_path", "filePath", "target", "to", "destination", "cwd"];

export function buildReceipt(input: {
  runId: string;
  agentId?: string;
  success: boolean;
  durationMs?: number;
  costUsd: number;
  entries: readonly ActionEntry[];
  derivedPaths?: readonly string[];
  tainted: boolean;
}): Receipt {
  const denied = new Set(
    input.entries.flatMap((e) =>
      e.reasons.filter((r) => r.startsWith("resolves:")).map((r) => r.slice("resolves:".length)),
    ),
  );
  const decisions = input.entries.filter(
    (e) =>
      !e.outcome &&
      !denied.has(e.id) &&
      !e.reasons.some((r) => r.startsWith("injection-suspected")),
  );
  const changed = new Set<string>(input.derivedPaths ?? []);
  for (const e of decisions) {
    if (e.decision === "allowed" || e.decision === "approval") {
      if (e.tier !== "read") {
        for (const key of PATH_KEYS) {
          const v = e.params[key];
          if (typeof v === "string" && v.length < 512) {
            changed.add(v);
          }
        }
      }
    }
  }
  const body = {
    runId: input.runId,
    agentId: input.agentId,
    finishedAt: new Date().toISOString(),
    success: input.success,
    durationMs: input.durationMs,
    costUsd: Number(input.costUsd.toFixed(6)),
    actions: {
      allowed: decisions.filter((e) => e.decision === "allowed").length,
      approved: decisions.filter((e) => e.decision === "approval").length,
      blocked: decisions.filter((e) => e.decision === "blocked").length,
      dryRun: decisions.filter((e) => e.decision === "dry-run").length,
    },
    tools: [...new Set(decisions.map((e) => e.toolName))].toSorted(),
    changed: [...changed].toSorted().slice(0, 200),
    blocked: decisions
      .filter((e) => e.decision === "blocked" || e.decision === "dry-run")
      .map((e) => ({ toolName: e.toolName, reason: e.reasons.join("; ") }))
      .slice(0, 50),
    tainted: input.tainted,
    logHead: input.entries.at(-1)?.hash,
  };
  const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return { ...body, digest };
}

export function formatReceipt(r: Receipt): string {
  const cost = r.costUsd < 0.01 ? `$${r.costUsd.toFixed(4)}` : `$${r.costUsd.toFixed(2)}`;
  const lines = [
    `Receipt ${r.runId.slice(0, 8)} · ${r.success ? "done" : "failed"} · ${cost}${r.durationMs ? ` · ${(r.durationMs / 1000).toFixed(1)}s` : ""}`,
    `Did: ${r.actions.allowed + r.actions.approved} actions (${r.actions.approved} approved by you)${r.tools.length ? ` using ${r.tools.join(", ")}` : ""}`,
  ];
  if (r.changed.length) {
    lines.push(
      `Changed: ${r.changed.slice(0, 8).join(", ")}${r.changed.length > 8 ? ` +${r.changed.length - 8} more` : ""}`,
    );
  }
  if (r.blocked.length) {
    lines.push(
      `Stopped: ${r.blocked
        .map((b) => `${b.toolName} (${b.reason})`)
        .slice(0, 5)
        .join("; ")}`,
    );
  }
  if (r.tainted) {
    lines.push(
      "Note: untrusted content in this run looked like a prompt injection; risky actions required approval.",
    );
  }
  lines.push(`Verify: ${r.digest.slice(0, 16)}`);
  return lines.join("\n");
}
