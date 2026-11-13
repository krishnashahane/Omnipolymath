/**
 * `omnipolymath firewall …` — inspect, verify and undo what agents did.
 *
 *   firewall status                 mode, today's spend, log health
 *   firewall log [--run id]         recent decisions
 *   firewall verify                 check the hash chain of the whole log
 *   firewall undo [run] [--dry-run] put files back the way a run found them
 *   firewall handoff keygen|issue|verify   signed agent-to-agent delegation
 */
import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { readLogFile, undoPlanFor, verifyChain, type ActionEntry } from "./action-log.js";
import type { TrustFirewallConfig } from "./config.js";
import {
  HandoffVerifier,
  createIdentity,
  identityFromPem,
  issueHandoff,
  type HandoffEnvelope,
} from "./handoff.js";
import { SnapshotStore } from "./snapshots.js";

export type FirewallPaths = {
  dir: string;
  logFile: string;
  spendFile: string;
  snapshotDir: string;
  identitiesDir: string;
};

export function firewallPaths(stateDir: string): FirewallPaths {
  const dir = path.join(stateDir, "trust-firewall");
  return {
    dir,
    logFile: path.join(dir, "actions.jsonl"),
    spendFile: path.join(dir, "spend.jsonl"),
    snapshotDir: path.join(dir, "snapshots"),
    identitiesDir: path.join(dir, "identities"),
  };
}

const out = (s: string) => process.stdout.write(`${s}\n`);

function spentToday(file: string): number {
  if (!fs.existsSync(file)) {
    return 0;
  }
  const today = new Date().toLocaleDateString("en-CA");
  let sum = 0;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    try {
      const e = line ? (JSON.parse(line) as { at: number; costUsd: number }) : undefined;
      if (e && new Date(e.at).toLocaleDateString("en-CA") === today) {
        sum += e.costUsd;
      }
    } catch {
      // ignore torn line
    }
  }
  return sum;
}

function describeEntry(e: ActionEntry): string {
  const when = e.at.replace("T", " ").slice(0, 19);
  const outcome = e.outcome ? (e.outcome.ok ? "ok" : `failed: ${e.outcome.error ?? ""}`) : "";
  return `${when}  ${e.decision.padEnd(8)} ${e.tier.padEnd(12)} ${e.toolName}  ${outcome || e.reasons.slice(0, 2).join("; ")}`;
}

function runsWithUndo(entries: readonly ActionEntry[]): string[] {
  const ids: string[] = [];
  for (const e of entries.toReversed()) {
    if (e.runId && e.undo?.files.length && !ids.includes(e.runId)) {
      ids.push(e.runId);
    }
  }
  return ids;
}

export function registerFirewallCli(
  program: Command,
  deps: { paths: FirewallPaths; config: TrustFirewallConfig },
): void {
  const { paths, config } = deps;
  const root = program
    .command("firewall")
    .description("Inspect, verify and undo what agents did (Trust Firewall)");

  root
    .command("status")
    .description("Show mode, today's spend and action log health")
    .option("--json", "Print JSON", false)
    .action((opts: { json?: boolean }) => {
      const entries = readLogFile(paths.logFile);
      const chain = verifyChain(entries);
      const status = {
        mode: config.mode,
        spentTodayUsd: Number(spentToday(paths.spendFile).toFixed(4)),
        dailySpendCapUsd: config.dailySpendCapUsd,
        logEntries: entries.length,
        logIntact: chain.ok,
        undoableRuns: runsWithUndo(entries).length,
        logFile: paths.logFile,
      };
      if (opts.json) {
        out(JSON.stringify(status, null, 2));
        return;
      }
      out(`Mode            ${status.mode}`);
      out(
        `Spent today     $${status.spentTodayUsd.toFixed(2)}${config.dailySpendCapUsd > 0 ? ` of $${config.dailySpendCapUsd.toFixed(2)}` : " (no cap)"}`,
      );
      out(
        `Action log      ${status.logEntries} entries, ${chain.ok ? "intact" : `BROKEN at #${chain.brokenAt} (${chain.reason})`}`,
      );
      out(`Undoable runs   ${status.undoableRuns}`);
    });

  root
    .command("log")
    .description("Show recent firewall decisions")
    .option("--run <id>", "Only this run")
    .option("--limit <n>", "How many entries", "40")
    .option("--json", "Print JSON", false)
    .action((opts: { run?: string; limit: string; json?: boolean }) => {
      let entries = readLogFile(paths.logFile);
      if (opts.run) {
        entries = entries.filter((e) => e.runId?.startsWith(opts.run!));
      }
      const limit = Math.max(1, Number.parseInt(opts.limit, 10) || 40);
      const rows = entries.slice(-limit);
      if (opts.json) {
        out(JSON.stringify(rows, null, 2));
        return;
      }
      if (!rows.length) {
        out("No firewall activity yet.");
        return;
      }
      for (const e of rows) {
        out(describeEntry(e));
      }
    });

  root
    .command("verify")
    .description("Check that no log entry was edited, removed or reordered")
    .action(() => {
      const entries = readLogFile(paths.logFile);
      const report = verifyChain(entries);
      if (report.ok) {
        out(`OK — ${report.checked} entries, hash chain intact.`);
        return;
      }
      out(`TAMPERED — entry #${report.brokenAt}: ${report.reason}`);
      process.exitCode = 1;
    });

  root
    .command("undo")
    .description("Restore files changed by write, edit and apply_patch in a run")
    .argument("[run]", "Run id (or a unique prefix); omit to list undoable runs")
    .option("--dry-run", "Show what would change without touching files", false)
    .option("--force", "Overwrite files that changed after the agent touched them", false)
    .action((run: string | undefined, opts: { dryRun?: boolean; force?: boolean }) => {
      const entries = readLogFile(paths.logFile);
      const runs = runsWithUndo(entries);
      if (!run) {
        if (!runs.length) {
          out("Nothing to undo yet.");
          return;
        }
        out("Runs with file changes (newest first):");
        for (const id of runs.slice(0, 20)) {
          const files = new Set(undoPlanFor(entries, id).map((f) => f.path));
          out(`  ${id}  ${files.size} file(s)`);
        }
        out("\nRun: omnipolymath firewall undo <run> --dry-run");
        return;
      }
      const matches = runs.filter((id) => id.startsWith(run));
      if (matches.length !== 1) {
        out(
          matches.length
            ? `"${run}" matches several runs; use more characters.`
            : `No undoable run matches "${run}".`,
        );
        process.exitCode = 1;
        return;
      }
      const store = new SnapshotStore(paths.snapshotDir);
      const results = store.restore(undoPlanFor(entries, matches[0]!), opts);
      for (const r of results) {
        out(`${r.status.padEnd(15)} ${r.path}${r.detail ? `  (${r.detail})` : ""}`);
      }
      if (results.some((r) => r.status === "conflict" || r.status === "missing-blob")) {
        process.exitCode = 1;
      }
    });

  const handoff = root
    .command("handoff")
    .description("Signed, scoped delegation between agents (Ed25519)");

  handoff
    .command("keygen")
    .description("Create a signing identity for an agent")
    .argument("<agent>", "Agent id")
    .action((agent: string) => {
      if (!/^[a-zA-Z0-9._-]{1,64}$/.test(agent)) {
        throw new Error("agent id may only contain letters, digits, '.', '_' and '-'");
      }
      const file = path.join(paths.identitiesDir, `${agent}.pem`);
      if (fs.existsSync(file)) {
        throw new Error(`identity already exists: ${file}`);
      }
      const id = createIdentity(agent);
      fs.mkdirSync(paths.identitiesDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, id.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), {
        mode: 0o600,
      });
      const pub = path.join(paths.identitiesDir, `${agent}.pub.pem`);
      fs.writeFileSync(pub, id.publicKeyPem, { mode: 0o644 });
      out(`Private key: ${file}\nPublic key:  ${pub} (share this with verifiers)`);
    });

  handoff
    .command("issue")
    .description("Delegate a task to another agent with exact capabilities")
    .requiredOption("--from <agent>", "Issuing agent (needs a keygen identity)")
    .requiredOption("--to <agent>", "Receiving agent")
    .requiredOption("--task <text>", "What the receiver may do")
    .requiredOption("--cap <capability...>", "Capabilities, e.g. calendar:read email:send")
    .option("--budget-cents <n>", "Spend budget in cents", "0")
    .option("--ttl-min <n>", "Minutes until it expires", "15")
    .action(
      (opts: {
        from: string;
        to: string;
        task: string;
        cap: string[];
        budgetCents: string;
        ttlMin: string;
      }) => {
        const file = path.join(paths.identitiesDir, `${opts.from}.pem`);
        const id = identityFromPem(opts.from, fs.readFileSync(file, "utf8"));
        const env = issueHandoff(id, opts.to, opts.task, opts.cap, {
          budgetCents: Math.max(0, Number.parseInt(opts.budgetCents, 10) || 0),
          ttlMs: Math.max(1, Number.parseInt(opts.ttlMin, 10) || 15) * 60_000,
        });
        out(JSON.stringify(env, null, 2));
      },
    );

  handoff
    .command("verify")
    .description("Verify a handoff envelope before acting on it")
    .argument("<file>", "Envelope JSON file")
    .requiredOption("--as <agent>", "Your agent id (must be the audience)")
    .requiredOption("--trust <agent=pemfile...>", "Trusted issuer public keys")
    .option("--need <capability...>", "Capabilities you are about to use", [])
    .action((file: string, opts: { as: string; trust: string[]; need: string[] }) => {
      const trusted: Record<string, string> = {};
      for (const pair of opts.trust) {
        const at = pair.indexOf("=");
        if (at <= 0) {
          throw new Error(`--trust expects agent=pemfile, got "${pair}"`);
        }
        trusted[pair.slice(0, at)] = fs.readFileSync(pair.slice(at + 1), "utf8");
      }
      const env = JSON.parse(fs.readFileSync(file, "utf8")) as HandoffEnvelope;
      const result = new HandoffVerifier(opts.as, trusted).verify(env, opts.need);
      if (result.ok) {
        out(`VALID — ${result.claims.issuer} → ${result.claims.audience}: ${result.claims.task}`);
        out(`Capabilities: ${result.claims.capabilities.join(", ")}`);
        out(`Expires: ${new Date(result.claims.expiresAt).toISOString()}`);
        return;
      }
      out(`REJECTED — ${result.reason}`);
      process.exitCode = 1;
    });
}
