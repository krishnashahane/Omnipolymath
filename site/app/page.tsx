import Link from "next/link";
import { Arrow } from "@/components/Icons";
import { QuickStart } from "@/components/QuickStart";
import { Reveal } from "@/components/Reveal";
import { Spotlight } from "@/components/Spotlight";
import "./home.css";

const HEADLINE = "The agent you can actually trust with your keys.";

/** One run, exactly as the Trust Firewall reports it. */
const SESSION: Array<{ t: string; kind?: "ok" | "ask" | "stop" | "note" | "dim"; tag?: string }> =
  [
    { t: "› Triage my inbox and pay anything due this week.", kind: "dim" },
    { t: "read      gmail.search  14 messages", kind: "ok", tag: "allowed" },
    { t: "shield    message #9 tries to give the agent orders", kind: "note", tag: "tainted" },
    { t: "write     drafts.create  3 replies", kind: "ok", tag: "allowed" },
    { t: "external  gmail.send  3 replies · run is tainted", kind: "ask", tag: "needs you" },
    { t: "spend     pay_invoice  $1,240 to acme", kind: "stop", tag: "blocked" },
    { t: "          wallet: over the $100 per-transaction limit", kind: "dim" },
  ];

const PRINCIPLES = [
  {
    title: "It asks before it acts.",
    body: "Reading is free. Anything that sends, spends or can't be taken back waits for your approval, and each agent only gets the tools you give it.",
  },
  {
    title: "It shows its work.",
    body: "Every decision is written to a hash-chained log, and every run ends with a receipt: what it did, what it cost, what changed and what was stopped.",
  },
  {
    title: "It can be undone.",
    body: "Files are snapshotted before the agent writes, edits or patches them. One command puts them back, and it never overwrites a change you made afterwards.",
  },
];

const CAPABILITIES: Array<[string, string, string]> = [
  [
    "Approvals",
    "Spend and irreversible actions always wait for you. Tool allowlists per agent.",
    "approveTiers",
  ],
  [
    "Injection shield",
    "Every tool result is pattern-scanned; web, email and chat content also gets a second opinion from your own model. A suspicious run loses the right to act alone.",
    "injection.classifier",
  ],
  [
    "Undo",
    "write, edit and apply_patch are snapshotted. Restore a whole run, or preview it first.",
    "omnipolymath firewall undo",
  ],
  [
    "Spend cap",
    "Priced from the cost your provider reports for each response. Survives restarts.",
    "dailySpendCapUsd",
  ],
  [
    "Agent wallets",
    "Per-transaction and daily limits on any tool that pays, charges or orders. Denied calls are refunded.",
    "wallet",
  ],
  [
    "Tamper-evident log",
    "Each entry carries the hash of the one before it. Editing history is detectable.",
    "omnipolymath firewall verify",
  ],
  [
    "Self-cleaning memory",
    "Facts carry provenance, decay and resolve contradictions. Facts learned from suspicious content start at low confidence.",
    "fact_save · fact_search",
  ],
  [
    "Checked skills",
    "Every skill is scanned for dangerous permissions at install. Publisher signatures are verified.",
    "skills.requireSignature",
  ],
  [
    "Signed handoffs",
    "Delegate a task to another agent with exact, expiring, Ed25519-signed scope.",
    "omnipolymath firewall handoff",
  ],
  [
    "No telemetry",
    "Nothing is sent anywhere unless you name an endpoint yourself.",
    "OMNIPOLYMATH_TELEMETRY_ENDPOINT",
  ],
];

const UNDO = [
  { t: "$ omnipolymath firewall undo 7f3a2c --dry-run", kind: "cmd" },
  { t: "would-restore   /Users/you/notes/plan.md" },
  { t: "would-delete    /Users/you/notes/draft-2.md" },
  { t: "$ omnipolymath firewall undo 7f3a2c", kind: "cmd" },
  { t: "restored        /Users/you/notes/plan.md" },
  { t: "deleted         /Users/you/notes/draft-2.md" },
];

export default function Home() {
  return (
    <>
      <section className="h-hero">
        <div className="wrap h-hero-grid">
          <div className="h-hero-copy">
            <Reveal instant>
              <p className="h-kicker">Open source · MIT · Runs on your machine</p>
            </Reveal>
            {/* Words blur in one at a time (after React Bits' BlurText); CSS only. */}
            <h1 className="h-title">
              <span className="sr-only">{HEADLINE}</span>
              <span aria-hidden="true">
                {HEADLINE.split(" ").map((word, i) => (
                  <span key={i} className="h-word" style={{ "--i": i } as React.CSSProperties}>
                    {word}{" "}
                  </span>
                ))}
              </span>
            </h1>
            <Reveal instant delay={120}>
              <p className="h-lede">
                Omnipolymath works across your inbox, files and accounts from the chat apps you
                already use. A firewall sits between it and everything it touches: it asks before
                anything irreversible, notices when a web page tries to take over, and hands you a
                receipt when it&rsquo;s done.
              </p>
            </Reveal>
            <Reveal instant delay={180}>
              <div className="h-actions">
                <a className="btn btn-accent" href="#install">
                  Install <Arrow />
                </a>
                <Link className="btn btn-ghost" href="/docs">
                  Read the docs
                </Link>
              </div>
            </Reveal>
          </div>
          <div className="h-stage">
            <figure className="h-terminal" aria-label="Example run with the Trust Firewall">
              <div className="h-terminal-bar">
                <span />
                <span />
                <span />
                <em>run 7f3a2c · Trust Firewall</em>
              </div>
              <ol>
                {SESSION.map((line, i) => (
                  <li
                    key={i}
                    className={line.kind ? `is-${line.kind}` : undefined}
                    style={{ "--i": i } as React.CSSProperties}
                  >
                    <code>{line.t}</code>
                    {line.tag ? <b>{line.tag}</b> : null}
                  </li>
                ))}
              </ol>
              <figcaption>
                <span>Receipt</span> 5 actions · 1 approved by you · 1 blocked · $0.03
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className="h-band" aria-labelledby="principles">
        <div className="wrap">
          <h2 id="principles" className="sr-only">
            Principles
          </h2>
          <div className="h-principles">
            {PRINCIPLES.map((p, i) => (
              <Reveal key={p.title} delay={i * 70}>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="h-section" id="receipts">
        <div className="wrap h-split">
          <Reveal className="h-split-copy">
            <p className="h-label">Does the work. Shows the receipts.</p>
            <h2>Made a mess? Put it back.</h2>
            <p>
              Before the agent changes a file, the firewall keeps a copy. Undo restores a whole run
              in one command, previews it first if you ask, and skips any file you&rsquo;ve edited
              since, unless you say otherwise.
            </p>
            <Link className="h-link" href="/docs/plugins/reference/trust-firewall">
              How undo works <Arrow size={14} />
            </Link>
          </Reveal>
          <Reveal delay={100}>
            <pre className="h-code" aria-label="Undo example">
              {UNDO.map((l, i) => (
                <span key={i} className={l.kind === "cmd" ? "is-cmd" : undefined}>
                  {l.t}
                  {"\n"}
                </span>
              ))}
            </pre>
          </Reveal>
        </div>
      </section>

      <section className="h-section" id="trust">
        <div className="wrap">
          <Reveal className="h-section-head">
            <p className="h-label">Autonomous, but never out of control.</p>
            <h2>Everything in the Trust Firewall</h2>
            <p>On by default. Every line below is shipping code with tests, not a roadmap.</p>
          </Reveal>
          <dl className="h-index">
            {CAPABILITIES.map(([name, body, key], i) => (
              <Reveal key={name} delay={(i % 2) * 60}>
                <Spotlight className="h-index-row">
                  <dt>{name}</dt>
                  <dd>
                    <p>{body}</p>
                    <code>{key}</code>
                  </dd>
                </Spotlight>
              </Reveal>
            ))}
          </dl>
        </div>
      </section>

      <section className="h-section" id="status">
        <div className="wrap">
          <Reveal className="h-section-head">
            <p className="h-label">Where it stands</p>
            <h2>What works today, and what doesn&rsquo;t yet</h2>
          </Reveal>
          <div className="h-status">
            <Spotlight className="h-status-card">
              <h3>Works today</h3>
              <ul>
                <li>The Gateway, CLI and browser Control UI, installed from source</li>
                <li>The chat-app channels, models and tools in the docs</li>
                <li>Everything in the Trust Firewall above</li>
                <li>Docker sandboxing for shell commands, one setting away</li>
              </ul>
            </Spotlight>
            <Spotlight className="h-status-card">
              <h3>Not yet</h3>
              <ul>
                <li>
                  An npm package: <code>npm install -g omnipolymath</code> doesn&rsquo;t work yet
                </li>
                <li>Desktop and mobile app downloads</li>
                <li>A Homebrew tap, Nix flake or Ansible playbook</li>
              </ul>
            </Spotlight>
          </div>
        </div>
      </section>

      <section className="h-install" id="install">
        <div className="wrap">
          <Reveal className="h-section-head">
            <p className="h-label">Install</p>
            <h2>Give it the keys. Keep the control.</h2>
            <p>
              The installer clones the source, builds it and links the{" "}
              <code>omnipolymath</code> command. It needs git, Node.js 24.16+ (or 26.1+) and pnpm,
              runs on macOS and Linux (Windows through WSL2), and never asks for root.
            </p>
          </Reveal>
          <Reveal delay={80}>
            <QuickStart />
            <p className="h-fine">
              Prefer to read it first?{" "}
              <a href="/install.sh" target="_blank" rel="noopener">
                View install.sh
              </a>{" "}
              · Then run <code>omnipolymath onboard</code> or use the{" "}
              <Link href="/onboarding">guided setup</Link>.
            </p>
          </Reveal>
        </div>
      </section>
    </>
  );
}
