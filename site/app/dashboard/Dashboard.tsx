"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Tier = "read" | "write" | "external" | "spend" | "irreversible";
type Decision = "allowed" | "approval" | "blocked" | "dry-run" | "undone";
type Entry = {
  seq: number;
  at: string;
  run: string;
  tool: string;
  tier: Tier;
  decision: Decision;
  detail: string;
  undo?: string;
  prevHash: string;
  hash: string;
};
type Approval = { id: string; run: string; title: string; why: string; tier: Tier };
type Receipt = {
  run: string;
  title: string;
  status: "done" | "failed" | "running";
  actions: number;
  stopped: number;
  cost: number;
  changed: string;
  when: string;
};
type Page = "overview" | "receipts" | "approvals" | "log" | "spend";

const RECEIPTS: Receipt[] = [
  {
    run: "r-7f2c",
    title: "Inbox triage",
    status: "done",
    actions: 9,
    stopped: 2,
    cost: 0.42,
    changed: "3 drafts, 1 event",
    when: "Today 09:12",
  },
  {
    run: "r-61aa",
    title: "Book dentist appointment",
    status: "running",
    actions: 3,
    stopped: 0,
    cost: 0.08,
    changed: "1 calendar hold",
    when: "Today 10:40",
  },
  {
    run: "r-5b19",
    title: "Summarize RFC thread",
    status: "done",
    actions: 4,
    stopped: 0,
    cost: 0.11,
    changed: "notes/rfc-42.md",
    when: "Yesterday 18:03",
  },
  {
    run: "r-44d0",
    title: "Clean up old branches",
    status: "done",
    actions: 6,
    stopped: 1,
    cost: 0.05,
    changed: "4 branches deleted",
    when: "Yesterday 11:27",
  },
  {
    run: "r-3e8b",
    title: "Weekly expense report",
    status: "failed",
    actions: 2,
    stopped: 1,
    cost: 0.19,
    changed: "none",
    when: "Mon 08:00",
  },
];

const SEED: Omit<Entry, "seq" | "prevHash" | "hash">[] = [
  {
    at: "09:12:01",
    run: "r-7f2c",
    tool: "gmail.list",
    tier: "read",
    decision: "allowed",
    detail: "14 unread messages",
  },
  {
    at: "09:12:05",
    run: "r-7f2c",
    tool: "web_fetch",
    tier: "read",
    decision: "allowed",
    detail: "Injection suspected in email #9 (score 0.82). Run tainted.",
  },
  {
    at: "09:12:09",
    run: "r-7f2c",
    tool: "drafts.create",
    tier: "write",
    decision: "allowed",
    detail: "Reply to Priya",
    undo: "drafts.delete",
  },
  {
    at: "09:12:30",
    run: "r-7f2c",
    tool: "message.send",
    tier: "external",
    decision: "approval",
    detail: "Send 3 replies (approved by you)",
  },
  {
    at: "09:12:41",
    run: "r-7f2c",
    tool: "payments.pay",
    tier: "spend",
    decision: "blocked",
    detail: "Invoice $1,240 is over the $500 wallet limit",
  },
  {
    at: "10:40:12",
    run: "r-61aa",
    tool: "calendar.create_event",
    tier: "write",
    decision: "allowed",
    detail: "Hold Thu 15:00",
    undo: "calendar.delete_event",
  },
];

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const body = (e: Omit<Entry, "hash">) =>
  JSON.stringify({
    seq: e.seq,
    at: e.at,
    run: e.run,
    tool: e.tool,
    tier: e.tier,
    decision: e.decision,
    detail: e.detail,
    undo: e.undo,
    prevHash: e.prevHash,
  });

async function chain(
  rows: Omit<Entry, "seq" | "prevHash" | "hash">[],
  start: Entry[] = [],
): Promise<Entry[]> {
  const out = [...start];
  for (const r of rows) {
    const prevHash = out.at(-1)?.hash ?? "0".repeat(64);
    const e = { ...r, seq: out.length + 1, prevHash };
    out.push({ ...e, hash: await sha256(body(e)) });
  }
  return out;
}

const TIER_TAG: Record<Tier, string> = {
  read: "neutral",
  write: "",
  external: "warn",
  spend: "warn",
  irreversible: "bad",
};
const DEC_TAG: Record<Decision, string> = {
  allowed: "",
  approval: "warn",
  blocked: "bad",
  "dry-run": "neutral",
  undone: "neutral",
};

export function Dashboard() {
  const [page, setPage] = useState<Page>("overview");
  const [log, setLog] = useState<Entry[]>([]);
  const [verify, setVerify] = useState<{ ok: boolean; msg: string } | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([
    {
      id: "a1",
      run: "r-61aa",
      title: "Email the clinic to confirm Thu 15:00",
      why: "External send",
      tier: "external",
    },
    {
      id: "a2",
      run: "r-44d0",
      title: "git push --force origin cleanup",
      why: "Irreversible: rewrites remote history",
      tier: "irreversible",
    },
  ]);
  const [dryRun, setDryRun] = useState(false);
  const [cap, setCap] = useState(10);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const spent = useMemo(
    () => RECEIPTS.filter((r) => r.when.startsWith("Today")).reduce((s, r) => s + r.cost, 0),
    [],
  );

  useEffect(() => {
    chain(SEED).then(setLog);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const logRef = useRef<Entry[]>([]);
  useEffect(() => {
    logRef.current = log;
  }, [log]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const append = useCallback((row: Omit<Entry, "seq" | "prevHash" | "hash">) => {
    // Serialize appends so each entry chains onto the previous one.
    queue.current = queue.current.then(async () => {
      const next = await chain([row], logRef.current);
      logRef.current = next;
      setLog(next);
    });
    return queue.current;
  }, []);

  const decide = async (a: Approval, allow: boolean) => {
    setApprovals((list) => list.filter((x) => x.id !== a.id));
    const now = new Date().toTimeString().slice(0, 8);
    if (dryRun && allow) {
      await append({
        at: now,
        run: a.run,
        tool: "approval",
        tier: a.tier,
        decision: "dry-run",
        detail: `Dry run: would ${a.title.toLowerCase()}`,
      });
      setToast("Dry run: nothing was sent or changed");
      return;
    }
    await append({
      at: now,
      run: a.run,
      tool: "approval",
      tier: a.tier,
      decision: allow ? "approval" : "blocked",
      detail: `${allow ? "Approved" : "Denied"}: ${a.title}`,
    });
    setToast(allow ? "Approved. The agent will continue." : "Denied. The action did not run.");
  };

  const undo = async (e: Entry) => {
    if (!e.undo) return;
    await append({
      at: new Date().toTimeString().slice(0, 8),
      run: e.run,
      tool: e.undo,
      tier: "write",
      decision: "undone",
      detail: `Undid #${e.seq} (${e.tool})`,
    });
    setToast(`Undo queued: ${e.undo}`);
  };

  const runVerify = async (tamper = false) => {
    const rows = log.map((e) => ({ ...e }));
    if (tamper && rows[2]) rows[2].detail = "Reply to Priya (edited)";
    let prev = "0".repeat(64);
    for (const e of rows) {
      const { hash, ...rest } = e;
      if (e.prevHash !== prev || (await sha256(body(rest))) !== hash) {
        setVerify({ ok: false, msg: `Chain broken at entry #${e.seq}. Someone edited the log.` });
        return;
      }
      prev = hash;
    }
    setVerify({ ok: true, msg: `All ${rows.length} entries verified. Head ${prev.slice(0, 12)}…` });
  };

  const filtered = RECEIPTS.filter((r) =>
    `${r.title} ${r.run} ${r.status}`.toLowerCase().includes(query.toLowerCase()),
  );
  const pct = Math.min(100, (spent / cap) * 100);

  const NAV: { id: Page; icon: string; label: string; count?: number }[] = [
    { id: "overview", icon: "🏠", label: "Overview" },
    { id: "receipts", icon: "🧾", label: "Receipts", count: RECEIPTS.length },
    { id: "approvals", icon: "✋", label: "Approvals", count: approvals.length },
    { id: "log", icon: "📜", label: "Action log", count: log.length },
    { id: "spend", icon: "💰", label: "Spend" },
  ];

  return (
    <div className="nd">
      <aside className="nd-side" aria-label="Workspace">
        <div className="nd-ws">
          <span className="nd-ws-ico">K</span>
          <span>
            <b>Krishna&apos;s workspace</b>
            <small>Demo · sample data</small>
          </span>
        </div>
        <nav className="nd-nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={page === n.id ? "on" : ""}
              aria-current={page === n.id ? "page" : undefined}
              onClick={() => setPage(n.id)}
            >
              <span>{n.icon}</span>
              {n.label}
              {n.count ? <em>{n.count}</em> : null}
            </button>
          ))}
        </nav>
        <div className="nd-side-foot">
          <div className="nd-row">
            <span>Dry-run mode</span>
            <button
              type="button"
              className="switch"
              role="switch"
              aria-checked={dryRun}
              aria-label="Dry-run mode"
              onClick={() => setDryRun((v) => !v)}
            />
          </div>
          <p className="muted">
            {dryRun ? "Nothing writes, sends or deletes." : "Enforce: approvals and limits apply."}
          </p>
        </div>
      </aside>

      <section className="nd-main">
        <div className="nd-banner">
          This is a demo workspace with sample data. Your real dashboard runs locally with{" "}
          <code>omnipolymath dashboard</code>.
        </div>

        {page === "overview" && (
          <div className="nd-page">
            <div className="nd-icon">🏠</div>
            <h1>Overview</h1>
            <div className="nd-props">
              <span>Status</span>
              <b>
                <span className="tag">Protected</span>
              </b>
              <span>Mode</span>
              <b>{dryRun ? "Dry run" : "Enforce"}</b>
              <span>Today</span>
              <b>
                ${spent.toFixed(2)} of ${cap} cap
              </b>
            </div>
            <div className="nd-cards">
              <button type="button" className="nd-card" onClick={() => setPage("approvals")}>
                <small>Waiting for you</small>
                <b>{approvals.length}</b>
                <span className="muted">approvals</span>
              </button>
              <button type="button" className="nd-card" onClick={() => setPage("receipts")}>
                <small>Runs today</small>
                <b>{RECEIPTS.filter((r) => r.when.startsWith("Today")).length}</b>
                <span className="muted">with receipts</span>
              </button>
              <button type="button" className="nd-card" onClick={() => setPage("log")}>
                <small>Stopped by firewall</small>
                <b>{RECEIPTS.reduce((s, r) => s + r.stopped, 0)}</b>
                <span className="muted">this week</span>
              </button>
            </div>
            <h2 className="nd-h2">Latest receipt</h2>
            <ReceiptCard r={RECEIPTS[0]!} />
          </div>
        )}

        {page === "receipts" && (
          <div className="nd-page">
            <div className="nd-icon">🧾</div>
            <h1>Receipts</h1>
            <div className="nd-toolbar">
              <input
                type="search"
                placeholder="Filter receipts…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Filter receipts"
              />
            </div>
            <div className="nd-table-wrap">
              <table className="nd-table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Status</th>
                    <th>Actions</th>
                    <th>Stopped</th>
                    <th>Changed</th>
                    <th>Cost</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.run}>
                      <td>
                        <b>{r.title}</b>
                        <br />
                        <span className="mono muted">{r.run}</span>
                      </td>
                      <td>
                        <span
                          className={`tag ${r.status === "failed" ? "bad" : r.status === "running" ? "warn" : ""}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td>{r.actions}</td>
                      <td>{r.stopped}</td>
                      <td>{r.changed}</td>
                      <td className="mono">${r.cost.toFixed(2)}</td>
                      <td className="muted">{r.when}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">
                        No receipts match “{query}”.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {page === "approvals" && (
          <div className="nd-page">
            <div className="nd-icon">✋</div>
            <h1>Approvals</h1>
            <p className="muted">The agent is paused on these. Nothing happens until you decide.</p>
            {approvals.length === 0 ? (
              <div className="nd-empty">
                <span>✨</span>
                <b>All clear</b>
                <p className="muted">Nothing is waiting for you.</p>
              </div>
            ) : (
              <div className="nd-approvals">
                {approvals.map((a) => (
                  <div key={a.id} className="nd-approval">
                    <div>
                      <span className={`tag ${TIER_TAG[a.tier]}`}>{a.tier}</span>
                      <b>{a.title}</b>
                      <p className="muted">
                        {a.why} · run <span className="mono">{a.run}</span>
                      </p>
                    </div>
                    <div className="nd-approval-btns">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => decide(a, false)}
                      >
                        Deny
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => decide(a, true)}>
                        {dryRun ? "Approve (dry run)" : "Approve once"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {page === "log" && (
          <div className="nd-page">
            <div className="nd-icon">📜</div>
            <h1>Action log</h1>
            <p className="muted">
              Every entry stores the SHA-256 of the one before it. Verify the chain right here in
              your browser.
            </p>
            <div className="nd-toolbar">
              <button type="button" className="btn btn-sm" onClick={() => runVerify(false)}>
                Verify chain
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => runVerify(true)}
              >
                Simulate tampering
              </button>
              {verify && <span className={`tag ${verify.ok ? "" : "bad"}`}>{verify.msg}</span>}
            </div>
            <ol className="nd-log">
              {log.map((e) => (
                <li key={e.seq}>
                  <span className="mono muted">#{e.seq}</span>
                  <div>
                    <div className="nd-log-top">
                      <b className="mono">{e.tool}</b>
                      <span className={`tag ${TIER_TAG[e.tier]}`}>{e.tier}</span>
                      <span className={`tag ${DEC_TAG[e.decision]}`}>{e.decision}</span>
                    </div>
                    <p>{e.detail}</p>
                    <span className="mono nd-hash">
                      {e.at} · {e.hash.slice(0, 16)}… ← {e.prevHash.slice(0, 8)}…
                    </span>
                  </div>
                  {e.undo && e.decision === "allowed" ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => undo(e)}>
                      Undo
                    </button>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        {page === "spend" && (
          <div className="nd-page">
            <div className="nd-icon">💰</div>
            <h1>Spend</h1>
            <div className="nd-meter panel">
              <div className="nd-meter-top">
                <b className="nd-big">${spent.toFixed(2)}</b>
                <span className="muted">of ${cap} today</span>
              </div>
              <div
                className="nd-meter-bar"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={cap}
                aria-valuenow={Number(spent.toFixed(2))}
                aria-label="Spend today"
              >
                <span
                  style={{
                    width: `${pct}%`,
                    background: pct > 90 ? "var(--bad)" : pct > 70 ? "var(--warn)" : "var(--ok)",
                  }}
                />
              </div>
              <label className="nd-cap">
                <span>Daily cap: ${cap}</span>
                <input
                  type="range"
                  min={1}
                  max={50}
                  value={cap}
                  onChange={(e) => setCap(Number(e.target.value))}
                />
              </label>
              <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                When the cap is reached, new runs and every non-read action stop until tomorrow.
              </p>
            </div>
            <h2 className="nd-h2">Routing</h2>
            <div className="nd-table-wrap">
              <table className="nd-table">
                <thead>
                  <tr>
                    <th>Prompt type</th>
                    <th>Model</th>
                    <th>Share of runs</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Routine (reminders, summaries, lookups)</td>
                    <td>Your cheap model</td>
                    <td>78%</td>
                  </tr>
                  <tr>
                    <td>Hard (code, analysis, planning)</td>
                    <td>Your best model</td>
                    <td>22%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
      {toast && (
        <div className="nd-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function ReceiptCard({ r }: { r: Receipt }) {
  return (
    <div className="receipt" style={{ maxWidth: 520 }}>
      <h4>Receipt · {r.run}</h4>
      <p className="r-title">{r.title}</p>
      <div className="r-row">
        <span>Did</span>
        <span>{r.actions} actions</span>
      </div>
      <div className="r-row">
        <span>Stopped</span>
        <span>{r.stopped}</span>
      </div>
      <div className="r-row">
        <span>Changed</span>
        <span>{r.changed}</span>
      </div>
      <div className="r-row r-total">
        <span>Cost</span>
        <span>${r.cost.toFixed(2)}</span>
      </div>
    </div>
  );
}
