"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "./Icons";

type Row = [slug: string, title: string, description: string, headings: string];

let cached: Promise<Row[]> | null = null;
const load = () =>
  (cached ??= fetch("/search-index.json")
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []));

function score(row: Row, terms: string[]): number {
  const [slug, title, desc, heads] = row.map((x) => x.toLowerCase()) as Row;
  let s = 0;
  for (const t of terms) {
    if (title.startsWith(t)) s += 12;
    else if (title.includes(t)) s += 8;
    else if (slug.includes(t)) s += 5;
    else if (heads.includes(t)) s += 3;
    else if (desc.includes(t)) s += 2;
    else return 0;
  }
  return s - slug.split("/").length * 0.1 - (slug.startsWith("releases") ? 3 : 0);
}

export function DocsSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (
        e.key === "/" &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!open) return;
    load().then(setRows);
    const t = setTimeout(() => input.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open]);

  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length)
      return rows
        .filter((r) => /^(start|install|gateway\/security|help\/faq)/.test(r[0]))
        .slice(0, 8);
    return rows
      .map((r) => [r, score(r, terms)] as const)
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([r]) => r);
  }, [rows, q]);
  useEffect(() => setActive(0), [q]);

  const go = (r: Row | undefined) => {
    if (!r) return;
    setOpen(false);
    setQ("");
    router.push(`/docs${r[0] ? `/${r[0]}` : ""}`);
  };

  return (
    <>
      <button type="button" className="docs-search-btn" onClick={() => setOpen(true)}>
        <Search size={15} />
        <span>Search docs</span>
        <kbd>⌘K</kbd>
      </button>
      {open && (
        <div className="cmdk-backdrop" onClick={() => setOpen(false)}>
          <div
            className="cmdk"
            role="dialog"
            aria-modal="true"
            aria-label="Search documentation"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cmdk-input">
              <Search />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search 1,400+ pages…"
                aria-label="Search documentation"
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, results.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === "Enter") go(results[active]);
                }}
              />
              <kbd>esc</kbd>
            </div>
            <ul className="cmdk-list" role="listbox">
              {results.map((r, i) => (
                <li key={r[0] || "home"} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    className={i === active ? "on" : ""}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r)}
                  >
                    <b>{r[1]}</b>
                    <span className="mono">/docs{r[0] ? `/${r[0]}` : ""}</span>
                    {r[2] ? <small>{r[2]}</small> : null}
                  </button>
                </li>
              ))}
              {rows.length > 0 && results.length === 0 ? (
                <li className="cmdk-empty muted">No pages match “{q}”.</li>
              ) : null}
              {rows.length === 0 ? <li className="cmdk-empty muted">Loading…</li> : null}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
