import type { ModelPrice } from "./budget.js";
import { EGRESS_MODES, type EgressMode } from "./egress.js";
import { UNSANDBOXED_SHELL_POLICIES, type UnsandboxedShellPolicy } from "./host-guard.js";
import type { RiskTier } from "./risk.js";

export type Posture = "restricted" | "balanced" | "personal";
export const POSTURES: Posture[] = ["restricted", "balanced", "personal"];

export type FirewallMode = "enforce" | "monitor" | "dry-run";

export type TrustFirewallConfig = {
  mode: FirewallMode;
  /** Tiers that always need a human approval before running. */
  approveTiers: RiskTier[];
  /** Extra tiers that need approval once a run has seen likely prompt injection. */
  taintedApproveTiers: RiskTier[];
  /** Tools that are never allowed. */
  blockedTools: string[];
  /** Least privilege: per-agent tool allowlists. Agents not listed are unrestricted. */
  agentToolAllowlist: Record<string, string[]>;
  injection: {
    enabled: boolean;
    threshold: number;
    /** Second opinion from a model when the pattern scan is not conclusive. */
    classifier: {
      enabled: boolean;
      /** Model ref; defaults to the agent's own model. */
      model?: string;
      timeoutMs: number;
      maxChars: number;
      minConfidence: number;
      /**
       * Skip the model call for content that never addresses an AI or gives
       * orders. Saves most classifier calls on ordinary pages and mail.
       */
      prefilter: boolean;
      /** Model checks per run; content past the limit gets the pattern scan only. */
      maxChecksPerRun: number;
    };
  };
  /** Spend limits enforced on every spend-tier tool call that names an amount. */
  wallet: {
    enabled: boolean;
    perTransactionUsd: number;
    dailyUsd: number;
    allowedPayees: string[];
  };
  /** Self-cleaning, injection-aware memory tools. */
  memory: { enabled: boolean; halfLifeDays: number; minConfidence: number; maxFacts: number };
  /** Checks run when a skill is installed. */
  skills: {
    scanOnInstall: boolean;
    blockHighRisk: boolean;
    requireSignature: boolean;
    /** Publisher name -> PEM public key. */
    trustedPublishers: Record<string, string>;
  };
  /** Snapshot files before write/edit/apply_patch so runs can be undone. */
  snapshots: { enabled: boolean };
  /** Warn at startup when Docker is available but the sandbox is off. */
  sandboxNudge: boolean;
  /**
   * Shell commands that run outside the sandbox: "approve-risky" asks before
   * commands that change the host (sudo, system files, global installs,
   * services, ssh keys), "approve-all" asks before every one, "allow" never asks.
   */
  unsandboxedShell: UnsandboxedShellPolicy;
  /** Preset that sets the defaults below; explicit fields still win. */
  posture: Posture;
  /** Network destinations agents may reach (see egress.ts). */
  egress: {
    /** "approve-new" asks before contacting a host outside allowedHosts. */
    mode: EgressMode;
    /** Hosts reachable without approval; "*.example.com" covers subdomains. */
    allowedHosts: string[];
    /** Always block cloud metadata and link-local destinations. */
    blockMetadata: boolean;
  };
  /** Environment hardening for shell commands the agent runs. */
  execEnv: {
    /** Set AWS_EC2_METADATA_DISABLED=true so SDKs never fetch instance credentials. */
    disableCloudMetadata: boolean;
  };
  /** Hard daily spend cap in USD. 0 disables the cap. */
  dailySpendCapUsd: number;
  /** Operator-supplied prices in USD per million tokens, keyed by model id. */
  prices: Record<string, ModelPrice>;
  /** Fallback price when neither config, the host nor the built-in table knows the model. */
  defaultPrice: ModelPrice;
  routing: {
    enabled: boolean;
    routineModel?: string;
    routineProvider?: string;
    hardModel?: string;
    hardProvider?: string;
  };
  receipts: { enabled: boolean };
  approvalTimeoutMs: number;
};

export const DEFAULT_CONFIG: TrustFirewallConfig = {
  mode: "enforce",
  approveTiers: ["spend", "irreversible"],
  taintedApproveTiers: ["external", "write"],
  blockedTools: [],
  agentToolAllowlist: {},
  injection: {
    enabled: true,
    threshold: 0.5,
    classifier: {
      enabled: true,
      timeoutMs: 8_000,
      maxChars: 12_000,
      minConfidence: 0.6,
      prefilter: true,
      maxChecksPerRun: 12,
    },
  },
  wallet: { enabled: true, perTransactionUsd: 100, dailyUsd: 250, allowedPayees: [] },
  memory: { enabled: true, halfLifeDays: 30, minConfidence: 0.2, maxFacts: 2_000 },
  skills: {
    scanOnInstall: true,
    blockHighRisk: false,
    requireSignature: false,
    trustedPublishers: {},
  },
  snapshots: { enabled: true },
  sandboxNudge: true,
  unsandboxedShell: "approve-risky",
  posture: "balanced",
  egress: { mode: "off", allowedHosts: [], blockMetadata: true },
  execEnv: { disableCloudMetadata: true },
  dailySpendCapUsd: 25,
  prices: {},
  defaultPrice: { inputPerMTok: 5, outputPerMTok: 25 },
  routing: { enabled: false },
  receipts: { enabled: true },
  approvalTimeoutMs: 120_000,
};

const TIERS: RiskTier[] = ["read", "write", "external", "spend", "irreversible"];

function fail(detail: string): never {
  throw new Error(`trust-firewall: ${detail}`);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function tiers(v: unknown, field: string, fallback: RiskTier[]): RiskTier[] {
  if (v === undefined) {
    return fallback;
  }
  if (!Array.isArray(v) || !v.every((t) => TIERS.includes(t as RiskTier))) {
    fail(`${field} must be a list of ${TIERS.join("|")}`);
  }
  return [...new Set(v as RiskTier[])];
}

function price(v: unknown, field: string): ModelPrice {
  if (
    !isObj(v) ||
    typeof v.inputPerMTok !== "number" ||
    typeof v.outputPerMTok !== "number" ||
    v.inputPerMTok < 0 ||
    v.outputPerMTok < 0 ||
    !Number.isFinite(v.inputPerMTok) ||
    !Number.isFinite(v.outputPerMTok)
  ) {
    fail(`${field} must be { inputPerMTok, outputPerMTok } with non-negative numbers`);
  }
  const out: ModelPrice = { inputPerMTok: v.inputPerMTok, outputPerMTok: v.outputPerMTok };
  for (const k of ["cacheReadPerMTok", "cacheWritePerMTok"] as const) {
    if (v[k] !== undefined) {
      if (typeof v[k] !== "number" || !Number.isFinite(v[k]) || (v[k] as number) < 0) {
        fail(`${field}.${k} must be a non-negative number`);
      }
      out[k] = v[k] as number;
    }
  }
  return out;
}

function strList(v: unknown, field: string): string[] {
  if (v === undefined) {
    return [];
  }
  if (
    !Array.isArray(v) ||
    !v.every((s) => typeof s === "string" && s.length > 0 && s.length <= 128)
  ) {
    fail(`${field} must be a list of tool names`);
  }
  return v as string[];
}

function bool(v: unknown, field: string, fallback: boolean): boolean {
  if (v === undefined) {
    return fallback;
  }
  if (typeof v !== "boolean") {
    fail(`${field} must be true or false`);
  }
  return v;
}

function num(
  v: unknown,
  field: string,
  fallback: number,
  min: number,
  max = Number.POSITIVE_INFINITY,
  integer = false,
): number {
  if (v === undefined) {
    return fallback;
  }
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    v < min ||
    v > max ||
    (integer && !Number.isInteger(v))
  ) {
    fail(`${field} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}`);
  }
  return v;
}

function obj(v: unknown, field: string): Record<string, unknown> | undefined {
  if (v === undefined) {
    return undefined;
  }
  if (!isObj(v)) {
    fail(`${field} must be an object`);
  }
  return v;
}

/**
 * Posture presets, after NemoClaw's onboarding tiers. "balanced" is the default
 * configuration; "restricted" asks before anything leaves the machine and before
 * contacting new hosts; "personal" trusts outbound messages from clean runs.
 */
function applyPosture(c: TrustFirewallConfig) {
  if (c.posture === "restricted") {
    c.approveTiers = ["external", "spend", "irreversible"];
    c.taintedApproveTiers = ["write", "external"];
    c.unsandboxedShell = "approve-all";
    c.egress.mode = "approve-new";
    c.skills.blockHighRisk = true;
  } else if (c.posture === "personal") {
    c.approveTiers = ["spend", "irreversible"];
    c.taintedApproveTiers = ["external"];
    c.unsandboxedShell = "approve-risky";
  }
}

export function parseConfig(raw: unknown): TrustFirewallConfig {
  if (raw === undefined || raw === null) {
    return structuredClone(DEFAULT_CONFIG);
  }
  if (!isObj(raw)) {
    fail("configuration must be an object");
  }
  const c = structuredClone(DEFAULT_CONFIG);
  if (raw.posture !== undefined) {
    if (!POSTURES.includes(raw.posture as Posture)) {
      fail(`posture must be one of ${POSTURES.join("|")}`);
    }
    c.posture = raw.posture as Posture;
    applyPosture(c);
  }
  if (raw.mode !== undefined) {
    if (raw.mode !== "enforce" && raw.mode !== "monitor" && raw.mode !== "dry-run") {
      fail("mode must be enforce|monitor|dry-run");
    }
    c.mode = raw.mode;
  }
  c.approveTiers = tiers(raw.approveTiers, "approveTiers", c.approveTiers);
  c.taintedApproveTiers = tiers(
    raw.taintedApproveTiers,
    "taintedApproveTiers",
    c.taintedApproveTiers,
  );
  c.blockedTools = strList(raw.blockedTools, "blockedTools");
  if (raw.agentToolAllowlist !== undefined) {
    if (!isObj(raw.agentToolAllowlist)) {
      fail("agentToolAllowlist must map agent ids to tool lists");
    }
    for (const [agent, list] of Object.entries(raw.agentToolAllowlist)) {
      c.agentToolAllowlist[agent] = strList(list, `agentToolAllowlist.${agent}`);
    }
  }
  if (raw.injection !== undefined) {
    if (!isObj(raw.injection)) {
      fail("injection must be an object");
    }
    if (raw.injection.enabled !== undefined) {
      c.injection.enabled = raw.injection.enabled === true;
    }
    if (raw.injection.threshold !== undefined) {
      const t = raw.injection.threshold;
      if (typeof t !== "number" || !(t > 0 && t <= 1)) {
        fail("injection.threshold must be in (0, 1]");
      }
      c.injection.threshold = t;
    }
    const cl = obj(raw.injection.classifier, "injection.classifier");
    if (cl) {
      const k = c.injection.classifier;
      k.enabled = bool(cl.enabled, "injection.classifier.enabled", k.enabled);
      if (cl.model !== undefined) {
        if (typeof cl.model !== "string" || !cl.model.trim()) {
          fail("injection.classifier.model must be a model ref like provider/model");
        }
        k.model = cl.model.trim();
      }
      k.timeoutMs = num(
        cl.timeoutMs,
        "injection.classifier.timeoutMs",
        k.timeoutMs,
        1_000,
        14_000,
        true,
      );
      k.maxChars = num(
        cl.maxChars,
        "injection.classifier.maxChars",
        k.maxChars,
        500,
        100_000,
        true,
      );
      k.minConfidence = num(
        cl.minConfidence,
        "injection.classifier.minConfidence",
        k.minConfidence,
        0,
        1,
      );
      k.prefilter = bool(cl.prefilter, "injection.classifier.prefilter", k.prefilter);
      k.maxChecksPerRun = num(
        cl.maxChecksPerRun,
        "injection.classifier.maxChecksPerRun",
        k.maxChecksPerRun,
        1,
        500,
        true,
      );
    }
  }
  const w = obj(raw.wallet, "wallet");
  if (w) {
    c.wallet.enabled = bool(w.enabled, "wallet.enabled", c.wallet.enabled);
    c.wallet.perTransactionUsd = num(
      w.perTransactionUsd,
      "wallet.perTransactionUsd",
      c.wallet.perTransactionUsd,
      0,
    );
    c.wallet.dailyUsd = num(w.dailyUsd, "wallet.dailyUsd", c.wallet.dailyUsd, 0);
    if (w.allowedPayees !== undefined) {
      if (
        !Array.isArray(w.allowedPayees) ||
        !w.allowedPayees.every((s) => typeof s === "string" && s.trim().length > 0)
      ) {
        fail("wallet.allowedPayees must be a list of payee names");
      }
      c.wallet.allowedPayees = (w.allowedPayees as string[]).map((s) => s.trim());
    }
  }
  const m = obj(raw.memory, "memory");
  if (m) {
    c.memory.enabled = bool(m.enabled, "memory.enabled", c.memory.enabled);
    c.memory.halfLifeDays = num(m.halfLifeDays, "memory.halfLifeDays", c.memory.halfLifeDays, 0.01);
    c.memory.minConfidence = num(
      m.minConfidence,
      "memory.minConfidence",
      c.memory.minConfidence,
      0,
      1,
    );
    c.memory.maxFacts = num(m.maxFacts, "memory.maxFacts", c.memory.maxFacts, 1, 100_000, true);
  }
  const sk = obj(raw.skills, "skills");
  if (sk) {
    c.skills.scanOnInstall = bool(sk.scanOnInstall, "skills.scanOnInstall", c.skills.scanOnInstall);
    c.skills.blockHighRisk = bool(sk.blockHighRisk, "skills.blockHighRisk", c.skills.blockHighRisk);
    c.skills.requireSignature = bool(
      sk.requireSignature,
      "skills.requireSignature",
      c.skills.requireSignature,
    );
    const pubs = obj(sk.trustedPublishers, "skills.trustedPublishers");
    for (const [name, key] of Object.entries(pubs ?? {})) {
      if (typeof key !== "string" || !key.includes("BEGIN PUBLIC KEY")) {
        fail(`skills.trustedPublishers.${name} must be a PEM public key`);
      }
      c.skills.trustedPublishers[name] = key;
    }
  }
  const snap = obj(raw.snapshots, "snapshots");
  if (snap) {
    c.snapshots.enabled = bool(snap.enabled, "snapshots.enabled", c.snapshots.enabled);
  }
  c.sandboxNudge = bool(raw.sandboxNudge, "sandboxNudge", c.sandboxNudge);
  if (raw.unsandboxedShell !== undefined) {
    const policy = raw.unsandboxedShell;
    if (!UNSANDBOXED_SHELL_POLICIES.includes(policy as UnsandboxedShellPolicy)) {
      fail(`unsandboxedShell must be one of ${UNSANDBOXED_SHELL_POLICIES.join("|")}`);
    }
    c.unsandboxedShell = policy as UnsandboxedShellPolicy;
  }
  if (raw.dailySpendCapUsd !== undefined) {
    const cap = raw.dailySpendCapUsd;
    if (typeof cap !== "number" || !Number.isFinite(cap) || cap < 0) {
      fail("dailySpendCapUsd must be a non-negative number");
    }
    c.dailySpendCapUsd = cap;
  }
  if (raw.prices !== undefined) {
    if (!isObj(raw.prices)) {
      fail("prices must map model ids to prices");
    }
    for (const [model, p] of Object.entries(raw.prices)) {
      c.prices[model] = price(p, `prices.${model}`);
    }
  }
  if (raw.defaultPrice !== undefined) {
    c.defaultPrice = price(raw.defaultPrice, "defaultPrice");
  }
  if (raw.routing !== undefined) {
    if (!isObj(raw.routing)) {
      fail("routing must be an object");
    }
    const r = raw.routing;
    for (const k of ["routineModel", "routineProvider", "hardModel", "hardProvider"] as const) {
      if (r[k] !== undefined && (typeof r[k] !== "string" || !(r[k] as string).trim())) {
        fail(`routing.${k} must be a non-empty string`);
      }
    }
    c.routing = {
      enabled: r.enabled === true,
      routineModel: r.routineModel as string | undefined,
      routineProvider: r.routineProvider as string | undefined,
      hardModel: r.hardModel as string | undefined,
      hardProvider: r.hardProvider as string | undefined,
    };
    if (c.routing.enabled && !c.routing.routineModel && !c.routing.hardModel) {
      fail("routing.enabled needs routineModel and/or hardModel");
    }
  }
  if (raw.receipts !== undefined) {
    if (!isObj(raw.receipts)) {
      fail("receipts must be an object");
    }
    c.receipts = { enabled: raw.receipts.enabled !== false };
  }
  const eg = obj(raw.egress, "egress");
  if (eg) {
    if (eg.mode !== undefined) {
      if (!EGRESS_MODES.includes(eg.mode as EgressMode)) {
        fail(`egress.mode must be one of ${EGRESS_MODES.join("|")}`);
      }
      c.egress.mode = eg.mode as EgressMode;
    }
    if (eg.allowedHosts !== undefined) {
      c.egress.allowedHosts = strList(eg.allowedHosts, "egress.allowedHosts").map((h) =>
        h.trim().toLowerCase(),
      );
    }
    c.egress.blockMetadata = bool(eg.blockMetadata, "egress.blockMetadata", c.egress.blockMetadata);
  }
  const ee = obj(raw.execEnv, "execEnv");
  if (ee) {
    c.execEnv.disableCloudMetadata = bool(
      ee.disableCloudMetadata,
      "execEnv.disableCloudMetadata",
      c.execEnv.disableCloudMetadata,
    );
  }
  if (raw.approvalTimeoutMs !== undefined) {
    const t = raw.approvalTimeoutMs;
    if (typeof t !== "number" || !Number.isInteger(t) || t < 5_000 || t > 3_600_000) {
      fail("approvalTimeoutMs must be an integer between 5000 and 3600000");
    }
    c.approvalTimeoutMs = t;
  }
  return c;
}
