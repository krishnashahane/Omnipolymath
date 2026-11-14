/**
 * The firewall: one object that sits between the agent and your accounts.
 * Host-independent so it can be unit-tested and reused by other agent runtimes.
 */
import { ActionLog, type ActionEntry } from "./action-log.js";
import { SpendLedger, classifyPrompt, type Usage } from "./budget.js";
import {
  InjectionClassifier,
  addressesAnAgent,
  isUntrustedSource,
  type CompleteFn,
} from "./classifier.js";
import type { TrustFirewallConfig } from "./config.js";
import { egressHosts, hostAllowed, isHardBlockedHost } from "./egress.js";
import { unsandboxedShellApproval } from "./host-guard.js";
import { scanForInjection, textOf, type InjectionScan } from "./injection.js";
import { ratesFromAssistant } from "./prices.js";
import { buildReceipt, type Receipt } from "./receipt.js";
import { assessToolCall, isShellTool, shellCommand, type RiskTier } from "./risk.js";
import { SnapshotStore, fileTargets, resolveTargetPath, type FileSnapshot } from "./snapshots.js";
import { WalletGuard, spendIntent } from "./wallet-guard.js";

export type ToolCallInput = {
  toolName: string;
  params: Record<string, unknown>;
  runId?: string;
  agentId?: string;
  derivedPaths?: readonly string[];
  /** Agent workspace used to resolve relative file paths for snapshots. */
  workspaceDir?: string;
  /**
   * Whether this call runs inside the agent sandbox. `false` turns on the
   * unsandboxed-shell guard; leave it undefined when the host cannot tell.
   */
  sandboxed?: boolean;
};

export type ToolDecision =
  | { kind: "allow"; entry: ActionEntry }
  | { kind: "block"; entry: ActionEntry; reason: string }
  | {
      kind: "approve";
      entry: ActionEntry;
      title: string;
      description: string;
      severity: "info" | "warning" | "critical";
    };

type RunState = {
  tainted: boolean;
  scans: InjectionScan[];
  paths: Set<string>;
  startedAt: number;
  pendingIds: Map<string, string>;
  /** In-flight classifier checks; risky calls wait for them. */
  checks: Set<Promise<void>>;
  /** Classifier calls started for this run (bounded by maxChecksPerRun). */
  classifierCalls: number;
};

type PendingCall = {
  snapshots?: FileSnapshot[];
  releaseWallet?: () => void;
  /** When the call was decided; stale entries are released (see sweepPending). */
  at?: number;
  /** New hosts this call contacts; remembered once a human approves the call. */
  egressHosts?: string[];
};

/** Local addresses never count as new egress destinations. */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

const MAX_RUNS = 512;

export class TrustFirewall {
  readonly log: ActionLog;
  readonly ledger: SpendLedger;
  private readonly runs = new Map<string, RunState>();
  private readonly receipts: Receipt[] = [];
  private readonly pending = new Map<string, PendingCall>();
  readonly snapshots: SnapshotStore;
  readonly wallets: WalletGuard;
  private classifier?: InjectionClassifier;
  private readonly now: () => number;
  /** Hosts a human approved this Gateway session (egress.mode "approve-new"). */
  private readonly approvedHosts = new Set<string>();

  constructor(
    readonly config: TrustFirewallConfig,
    opts: {
      logFile?: string;
      spendFile?: string;
      snapshotDir?: string;
      now?: () => number;
      complete?: CompleteFn;
    } = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.log = new ActionLog(opts.logFile);
    this.ledger = new SpendLedger(
      config.dailySpendCapUsd,
      config.prices,
      config.defaultPrice,
      opts.now,
      undefined,
      opts.spendFile,
    );
    this.snapshots = new SnapshotStore(opts.snapshotDir);
    this.wallets = new WalletGuard(config.wallet, opts.now);
    if (opts.complete && config.injection.enabled && config.injection.classifier.enabled) {
      this.classifier = new InjectionClassifier(opts.complete, config.injection.classifier);
    }
  }

  private run(runId: string | undefined): RunState | undefined {
    if (!runId) {
      return undefined;
    }
    let state = this.runs.get(runId);
    if (!state) {
      state = {
        tainted: false,
        scans: [],
        paths: new Set(),
        startedAt: Date.now(),
        pendingIds: new Map(),
        checks: new Set(),
        classifierCalls: 0,
      };
      this.runs.set(runId, state);
      if (this.runs.size > MAX_RUNS) {
        this.runs.delete(this.runs.keys().next().value!);
      }
    }
    return state;
  }

  isTainted(runId?: string): boolean {
    return runId ? this.runs.get(runId)?.tainted === true : false;
  }

  /**
   * A call that was approved but never finished (cancelled run, lost hook)
   * would otherwise hold its wallet reservation forever. Release anything older
   * than twice the approval timeout plus an hour of run time.
   */
  sweepPending(): number {
    const cutoff = this.now() - (2 * this.config.approvalTimeoutMs + 3_600_000);
    let released = 0;
    for (const [id, extra] of this.pending) {
      if ((extra.at ?? 0) < cutoff) {
        extra.releaseWallet?.();
        this.pending.delete(id);
        released += 1;
      }
    }
    return released;
  }

  beforeToolCall(call: ToolCallInput, toolCallId?: string): ToolDecision {
    this.sweepPending();
    const { toolName, params, runId, agentId } = call;
    const risk = assessToolCall(toolName, params);
    const state = this.run(runId);
    for (const p of call.derivedPaths ?? []) {
      state?.paths.add(p);
    }
    const record = (
      decision: ActionEntry["decision"],
      reasons: string[],
      extra: PendingCall = {},
    ) => {
      const entry = this.log.append({
        runId,
        agentId,
        toolName,
        tier: risk.tier,
        decision,
        reasons,
        params,
        undo: extra.snapshots?.length
          ? { kind: "restore-files", files: extra.snapshots }
          : undefined,
      });
      if (toolCallId) {
        state?.pendingIds.set(toolCallId, entry.id);
      }
      if (extra.snapshots || extra.releaseWallet || extra.egressHosts) {
        extra.at = this.now();
        this.pending.set(entry.id, extra);
      }
      return entry;
    };
    /** Work that only happens for calls that may actually run. */
    const prepare = (): PendingCall | { blocked: string } => {
      const extra: PendingCall = {};
      if (risk.tier === "spend" && this.config.wallet.enabled) {
        const intent = spendIntent(params);
        if (intent) {
          const check = this.wallets.check(agentId, intent);
          if (!check.ok) {
            return { blocked: check.reason };
          }
          extra.releaseWallet = check.release;
          risk.reasons.push(
            `wallet: $${(intent.amountCents / 100).toFixed(2)} to ${intent.payee} reserved`,
          );
        }
      }
      if (this.config.snapshots.enabled) {
        const targets = fileTargets(toolName, params, call.derivedPaths);
        if (targets.length) {
          extra.snapshots = targets.map((t) => {
            const abs = resolveTargetPath(t, call.workspaceDir);
            return abs
              ? this.snapshots.capture(abs)
              : { path: t, existed: true, skipped: "agent workspace unknown" };
          });
        }
      }
      return extra;
    };
    const monitor = this.config.mode === "monitor";
    const block = (reason: string): ToolDecision => {
      if (monitor) {
        return {
          kind: "allow",
          entry: record("allowed", [...risk.reasons, `monitor: would block (${reason})`]),
        };
      }
      return { kind: "block", entry: record("blocked", [...risk.reasons, reason]), reason };
    };

    if (this.config.blockedTools.includes(toolName)) {
      return block(`${toolName} is blocked by policy`);
    }
    const allow = agentId ? this.config.agentToolAllowlist[agentId] : undefined;
    if (allow && !allow.includes(toolName)) {
      return block(`least privilege: ${agentId} may not use ${toolName}`);
    }
    const hosts = egressHosts(params, isShellTool(toolName) ? shellCommand(params) : undefined);
    if (this.config.egress.blockMetadata) {
      const blocked = hosts.find((h) => isHardBlockedHost(h));
      if (blocked) {
        return block(`${blocked} is a cloud metadata or link-local address`);
      }
    }
    if (risk.tier !== "read" && this.ledger.capReached()) {
      return block(`daily spend cap of $${this.ledger.cap.toFixed(2)} reached`);
    }
    if (this.config.mode === "dry-run" && risk.tier !== "read") {
      return {
        kind: "block",
        entry: record("dry-run", risk.reasons),
        reason: `dry run: would ${describe(toolName, params)} (${risk.tier})`,
      };
    }
    const prepared = prepare();
    if ("blocked" in prepared) {
      return block(prepared.blocked);
    }
    const tainted = state?.tainted === true;
    const hostRisk =
      call.sandboxed === false && isShellTool(toolName)
        ? unsandboxedShellApproval(shellCommand(params) ?? "", this.config.unsandboxedShell)
        : undefined;
    if (hostRisk) {
      risk.reasons.push(...hostRisk);
    }
    const newHosts =
      this.config.egress.mode === "approve-new"
        ? hosts.filter(
            (h) =>
              !hostAllowed(h, LOCAL_HOSTS) &&
              !hostAllowed(h, this.config.egress.allowedHosts) &&
              !this.approvedHosts.has(h),
          )
        : [];
    if (newHosts.length) {
      risk.reasons.push(...newHosts.map((h) => `new host: ${h}`));
      prepared.egressHosts = newHosts;
    }
    const tierApproval = this.config.approveTiers.includes(risk.tier);
    const taintApproval = tainted && this.config.taintedApproveTiers.includes(risk.tier);
    const needsApproval =
      tierApproval || taintApproval || hostRisk !== undefined || newHosts.length > 0;
    if (needsApproval && !monitor) {
      const why = tierApproval
        ? `${risk.tier} action`
        : taintApproval
          ? "this run read content that looks like a prompt injection"
          : hostRisk !== undefined
            ? "this shell command runs outside the sandbox and changes this machine"
            : "it contacts a host you have not approved yet";
      return {
        kind: "approve",
        entry: record("approval", risk.reasons, prepared),
        title: `Approve ${toolName}?`,
        description: `${describe(toolName, params)} — ${why}. Reasons: ${risk.reasons.join(", ")}.`,
        severity: risk.tier === "irreversible" || tainted ? "critical" : "warning",
      };
    }
    return { kind: "allow", entry: record("allowed", risk.reasons, prepared) };
  }

  /** Wait (bounded) for classifier checks still running for this run. */
  async awaitChecks(runId?: string): Promise<void> {
    const checks = runId ? this.runs.get(runId)?.checks : undefined;
    if (!checks?.size) {
      return;
    }
    const limit = this.config.injection.classifier.timeoutMs + 500;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, limit);
    });
    try {
      await Promise.race([Promise.allSettled(checks), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Record how a human answered an approval request. Denials and timeouts are logged as blocks. */
  resolveApproval(entry: ActionEntry, decision: string): ActionEntry | undefined {
    if (decision === "allow-once" || decision === "allow-always") {
      for (const host of this.pending.get(entry.id)?.egressHosts ?? []) {
        this.approvedHosts.add(host);
      }
      return undefined;
    }
    const extra = this.pending.get(entry.id);
    extra?.releaseWallet?.();
    this.pending.delete(entry.id);
    return this.log.append({
      runId: entry.runId,
      agentId: entry.agentId,
      toolName: entry.toolName,
      tier: entry.tier,
      decision: "blocked",
      reasons: [`approval ${decision}`, `resolves:${entry.id}`],
      params: entry.params,
    });
  }

  afterToolCall(input: {
    toolName: string;
    runId?: string;
    toolCallId?: string;
    result?: unknown;
    error?: string;
    durationMs?: number;
    agentId?: string;
  }): InjectionScan | undefined {
    const state = this.run(input.runId);
    const entryId = input.toolCallId ? state?.pendingIds.get(input.toolCallId) : undefined;
    if (entryId) {
      const extra = this.pending.get(entryId);
      this.pending.delete(entryId);
      if (input.error) {
        // A failed spend call did not move money; give the reservation back.
        extra?.releaseWallet?.();
      }
      const settled = extra?.snapshots?.map((snap) => this.snapshots.settle(snap));
      this.log.recordOutcome(
        entryId,
        { ok: !input.error, error: input.error?.slice(0, 500), durationMs: input.durationMs },
        settled?.length ? { kind: "restore-files", files: settled } : undefined,
      );
      state?.pendingIds.delete(input.toolCallId!);
    }
    if (!this.config.injection.enabled || input.result === undefined) {
      return undefined;
    }
    const content = textOf(input.result);
    const scan = scanForInjection(content, this.config.injection.threshold);
    if (scan.flagged && state) {
      this.taint(state, input.runId, input.toolName, [
        `injection-suspected score=${scan.score}`,
        ...scan.signals.map((s) => s.id),
      ]);
      state.scans.push(scan);
    } else if (
      state &&
      this.classifier &&
      content.trim().length >= 40 &&
      isUntrustedSource(input.toolName) &&
      (!this.config.injection.classifier.prefilter || addressesAnAgent(content))
    ) {
      if (state.classifierCalls >= this.config.injection.classifier.maxChecksPerRun) {
        if (state.classifierCalls === this.config.injection.classifier.maxChecksPerRun) {
          state.classifierCalls += 1;
          this.log.append({
            runId: input.runId,
            toolName: input.toolName,
            tier: "read",
            decision: "allowed",
            reasons: [
              `injection-classifier skipped: ${this.config.injection.classifier.maxChecksPerRun} checks per run reached; pattern scan only`,
            ],
            params: {},
          });
        }
        return scan;
      }
      state.classifierCalls += 1;
      const classifier = this.classifier;
      const check = classifier
        .classify(content, input.toolName, input.agentId)
        .then((verdict) => {
          if (verdict.status === "unavailable") {
            this.log.append({
              runId: input.runId,
              toolName: input.toolName,
              tier: "read",
              decision: "allowed",
              reasons: [`injection-classifier unavailable: ${verdict.reason}`],
              params: {},
            });
            return;
          }
          if (verdict.costUsd) {
            this.ledger.recordCost("trust-firewall/classifier", verdict.costUsd, input.runId);
          }
          if (
            verdict.injection &&
            verdict.confidence >= this.config.injection.classifier.minConfidence
          ) {
            this.taint(state, input.runId, input.toolName, [
              `injection-classifier confidence=${verdict.confidence}`,
              verdict.reason,
            ]);
          }
        })
        .finally(() => state.checks.delete(check));
      state.checks.add(check);
    }
    return scan;
  }

  private taint(state: RunState, runId: string | undefined, toolName: string, reasons: string[]) {
    state.tainted = true;
    this.log.append({
      runId,
      toolName,
      tier: "read",
      decision: "allowed",
      reasons,
      params: {},
    });
  }

  /**
   * Charge model usage to the ledger. `lastAssistant` (when the host passes it)
   * carries the host's own cost breakdown, which teaches the ledger exact rates.
   */
  recordUsage(model: string, usage: Usage | undefined, runId?: string, lastAssistant?: unknown) {
    this.ledger.learn(model, ratesFromAssistant(lastAssistant));
    return this.ledger.record(model, usage, runId);
  }

  route(
    prompt: string,
    attachments = 0,
  ): { modelOverride?: string; providerOverride?: string } | undefined {
    const r = this.config.routing;
    if (!r.enabled) {
      return undefined;
    }
    const tier = classifyPrompt(prompt, attachments);
    const model = tier === "hard" ? r.hardModel : r.routineModel;
    const provider = tier === "hard" ? r.hardProvider : r.routineProvider;
    if (!model) {
      return undefined;
    }
    return provider
      ? { modelOverride: model, providerOverride: provider }
      : { modelOverride: model };
  }

  capStatus(): { reached: boolean; spentUsd: number; capUsd: number } {
    return {
      reached: this.ledger.capReached(),
      spentUsd: this.ledger.spentToday(),
      capUsd: this.ledger.cap,
    };
  }

  finishRun(input: {
    runId: string;
    agentId?: string;
    success: boolean;
    durationMs?: number;
  }): Receipt {
    const state = this.runs.get(input.runId);
    const receipt = buildReceipt({
      runId: input.runId,
      agentId: input.agentId,
      success: input.success,
      durationMs: input.durationMs,
      costUsd: this.ledger.spentForRun(input.runId),
      entries: this.log.list({ runId: input.runId }),
      derivedPaths: state ? [...state.paths] : [],
      tainted: state?.tainted === true,
    });
    this.receipts.push(receipt);
    if (this.receipts.length > 200) {
      this.receipts.shift();
    }
    this.runs.delete(input.runId);
    return receipt;
  }

  recentReceipts(limit = 20): Receipt[] {
    return this.receipts.slice(-limit);
  }
}

function describe(toolName: string, params: Record<string, unknown>): string {
  const cmd = typeof params.command === "string" ? params.command : undefined;
  if (cmd) {
    return `run \`${cmd.length > 160 ? `${cmd.slice(0, 160)}…` : cmd}\``;
  }
  const target = ["path", "to", "recipient", "url", "file_path"]
    .map((k) => params[k])
    .find((v) => typeof v === "string") as string | undefined;
  return target ? `${toolName} → ${target.slice(0, 160)}` : `call ${toolName}`;
}

export type { RiskTier };
