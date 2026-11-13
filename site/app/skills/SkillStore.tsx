"use client";

import { useEffect, useMemo, useState } from "react";
import { Close, Search, Sliders } from "@/components/Icons";
import type { Skill } from "@/lib/content";

const CATEGORIES: { id: string; emoji: string; label: string; match: RegExp }[] = [
  { id: "all", emoji: "✦", label: "All", match: /./ },
  {
    id: "notes",
    emoji: "🗒️",
    label: "Notes",
    match: /note|obsidian|bear|notion|todo|task|remind|things/i,
  },
  {
    id: "media",
    emoji: "🎧",
    label: "Media",
    match: /music|spotify|sonos|audio|video|gif|image|photo|camera|song|tts|voice/i,
  },
  {
    id: "dev",
    emoji: "🧑‍💻",
    label: "Developer",
    match: /git|code|github|tmux|coding|terminal|cli|ci|session/i,
  },
  { id: "home", emoji: "🏠", label: "Home", match: /home|light|hue|sleep|eight|sonos|blu|device/i },
  {
    id: "web",
    emoji: "🌐",
    label: "Web",
    match: /web|search|browser|blog|rss|summar|weather|place|map/i,
  },
  {
    id: "comms",
    emoji: "💬",
    label: "Messaging",
    match: /message|imessage|slack|discord|email|mail|whatsapp|call|sms/i,
  },
  {
    id: "security",
    emoji: "🔐",
    label: "Security",
    match: /1password|secret|password|auth|security|health/i,
  },
];

type Filters = { risk: Set<string>; noSecrets: boolean; noBins: boolean; os: string };
const EMPTY: Filters = { risk: new Set(), noSecrets: false, noBins: false, os: "any" };

export function SkillStore({ skills }: { skills: Skill[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Filters>(EMPTY);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [selected, setSelected] = useState<Skill | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    document.body.style.overflow = open || selected ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open, selected]);

  const apply = (filters: Filters, list: Skill[]) =>
    list.filter((s) => {
      if (filters.risk.size && !filters.risk.has(s.risk)) return false;
      if (
        filters.noSecrets &&
        (s.env.length > 0 ||
          s.findings.some((x) => x.id === "secret-read" || x.id === "env-secrets"))
      )
        return false;
      if (filters.noBins && s.bins.length > 0) return false;
      if (filters.os !== "any" && s.os.length > 0 && !s.os.includes(filters.os)) return false;
      return true;
    });

  const results = useMemo(() => {
    const category = CATEGORIES.find((c) => c.id === cat)!;
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return apply(
      f,
      skills.filter((s) => {
        const hay = `${s.name} ${s.description} ${s.bins.join(" ")}`.toLowerCase();
        return (
          (cat === "all" || category.match.test(`${s.name} ${s.description}`)) &&
          terms.every((t) => hay.includes(t))
        );
      }),
    );
  }, [skills, q, cat, f]);

  const activeCount =
    f.risk.size + (f.noSecrets ? 1 : 0) + (f.noBins ? 1 : 0) + (f.os !== "any" ? 1 : 0);
  const draftCount = apply(draft, skills).length;

  return (
    <div className="ss">
      <div className="ss-hero wrap">
        <h1>
          Skills you can actually vet.
        </h1>
        <p className="muted">
          Every skill below has been scanned for what it can run and what it can read, before you
          install it.
        </p>
        <div className="ss-search" role="search">
          <label className="ss-seg grow">
            <span>What</span>
            <input
              type="search"
              placeholder="Search skills, tools, apps"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search skills"
            />
          </label>
          <button
            type="button"
            className="ss-seg"
            onClick={() => {
              setDraft(f);
              setOpen(true);
            }}
          >
            <span>Trust</span>
            <b>{f.risk.size ? [...f.risk].map((r) => `${r} risk`).join(", ") : "Any risk"}</b>
          </button>
          <button
            type="button"
            className="ss-go"
            aria-label="Search"
            onClick={() =>
              document.getElementById("ss-results")?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <Search />
          </button>
        </div>
      </div>

      <div className="ss-bar">
        <div className="wrap ss-bar-inner">
          <div className="ss-cats" role="tablist" aria-label="Categories">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                role="tab"
                type="button"
                aria-selected={cat === c.id}
                className={cat === c.id ? "on" : ""}
                onClick={() => setCat(c.id)}
              >
                <span>{c.emoji}</span>
                {c.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ss-filter"
            onClick={() => {
              setDraft(f);
              setOpen(true);
            }}
          >
            <Sliders size={16} /> Filters{activeCount ? <em>{activeCount}</em> : null}
          </button>
        </div>
      </div>

      <div className="wrap" id="ss-results">
        <p className="ss-count muted">
          {results.length} {results.length === 1 ? "skill" : "skills"}
          {q ? ` for “${q}”` : ""}
        </p>
        {results.length === 0 ? (
          <div className="nd-empty">
            <span>🔍</span>
            <b>No skills match</b>
            <p className="muted">Try another search or clear the filters.</p>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setQ("");
                setCat("all");
                setF(EMPTY);
              }}
            >
              Clear everything
            </button>
          </div>
        ) : (
          <div className="ss-grid">
            {results.map((s) => (
              <button type="button" key={s.slug} className="ss-card" onClick={() => setSelected(s)}>
                <div className="ss-art" data-risk={s.risk}>
                  <span>{s.emoji}</span>
                  <span
                    className={`tag ${s.risk === "high" ? "bad" : s.risk === "medium" ? "warn" : ""}`}
                  >
                    {s.risk} risk
                  </span>
                </div>
                <div className="ss-meta">
                  <b>{s.name}</b>
                  <p>{s.description}</p>
                  <span className="muted">
                    {s.bins.length ? `Runs ${s.bins.slice(0, 3).join(", ")}` : "No local tools"}
                    {s.env.length
                      ? ` · reads ${s.env.length} secret${s.env.length > 1 ? "s" : ""}`
                      : ""}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="filters-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-head">
              <button
                type="button"
                className="menu-btn"
                aria-label="Close filters"
                onClick={() => setOpen(false)}
              >
                <Close />
              </button>
              <b id="filters-title">Filters</b>
              <span />
            </div>
            <div className="sheet-body">
              <h3>Risk level</h3>
              <div className="chips">
                {["low", "medium", "high"].map((r) => {
                  const on = draft.risk.has(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      className={`chip${on ? " on" : ""}`}
                      aria-pressed={on}
                      onClick={() =>
                        setDraft((d) => {
                          const risk = new Set(d.risk);
                          if (on) risk.delete(r);
                          else risk.add(r);
                          return { ...d, risk };
                        })
                      }
                    >
                      {r[0]!.toUpperCase() + r.slice(1)} risk
                    </button>
                  );
                })}
              </div>
              <h3>Permissions</h3>
              <label className="sheet-row">
                <span>
                  <b>Reads no secrets</b>
                  <small className="muted">No API keys, tokens or stored credentials</small>
                </span>
                <button
                  type="button"
                  className="switch"
                  role="switch"
                  aria-checked={draft.noSecrets}
                  aria-label="Reads no secrets"
                  onClick={() => setDraft((d) => ({ ...d, noSecrets: !d.noSecrets }))}
                />
              </label>
              <label className="sheet-row">
                <span>
                  <b>Needs no local tools</b>
                  <small className="muted">Does not require installing binaries</small>
                </span>
                <button
                  type="button"
                  className="switch"
                  role="switch"
                  aria-checked={draft.noBins}
                  aria-label="Needs no local tools"
                  onClick={() => setDraft((d) => ({ ...d, noBins: !d.noBins }))}
                />
              </label>
              <h3>Platform</h3>
              <div className="chips">
                {[
                  ["any", "Any"],
                  ["darwin", "macOS"],
                  ["linux", "Linux"],
                  ["win32", "Windows"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`chip${draft.os === id ? " on" : ""}`}
                    aria-pressed={draft.os === id}
                    onClick={() => setDraft((d) => ({ ...d, os: id! }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sheet-foot">
              <button type="button" className="ss-clear" onClick={() => setDraft(EMPTY)}>
                Clear all
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setF(draft);
                  setOpen(false);
                }}
              >
                Show {draftCount} {draftCount === 1 ? "skill" : "skills"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="sheet-backdrop" onClick={() => setSelected(null)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="skill-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-head">
              <button
                type="button"
                className="menu-btn"
                aria-label="Close"
                onClick={() => setSelected(null)}
              >
                <Close />
              </button>
              <b id="skill-title">
                {selected.emoji} {selected.name}
              </b>
              <span />
            </div>
            <div className="sheet-body">
              <p>{selected.description}</p>
              <h3>Trust scan</h3>
              <div className="scan">
                <div className="sheet-row">
                  <span>Signature</span>
                  <span className="tag neutral">Not signed yet</span>
                </div>
                <div className="sheet-row">
                  <span>Overall risk</span>
                  <span
                    className={`tag ${selected.risk === "high" ? "bad" : selected.risk === "medium" ? "warn" : ""}`}
                  >
                    {selected.risk}
                  </span>
                </div>
                <div className="sheet-row">
                  <span>Runs locally</span>
                  <span className="mono">
                    {selected.bins.length ? selected.bins.join(", ") : "nothing"}
                  </span>
                </div>
                <div className="sheet-row">
                  <span>Secrets it needs</span>
                  <span className="mono">
                    {selected.env.length ? selected.env.join(", ") : "none"}
                  </span>
                </div>
                {selected.findings.length > 0 ? (
                  <ul className="findings">
                    {selected.findings.map((x) => (
                      <li key={x.id}>
                        <span
                          className={`tag ${x.severity === "high" ? "bad" : x.severity === "medium" ? "warn" : "neutral"}`}
                        >
                          {x.severity}
                        </span>{" "}
                        {x.detail}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No risky patterns found in the skill files.</p>
                )}
              </div>
              <h3>Install</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                Bundled with Omnipolymath. It becomes available as soon as its requirements are met.
                Check it with <code>omnipolymath skills info {selected.slug}</code>.
              </p>
              {selected.homepage && /^https:\/\//.test(selected.homepage) ? (
                <a
                  className="btn btn-ghost btn-sm"
                  href={selected.homepage}
                  rel="noopener noreferrer"
                >
                  Tool homepage
                </a>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
