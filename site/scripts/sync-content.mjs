#!/usr/bin/env node
// Copies the repository's docs and skills into site/content so the site can be
// built (and deployed) on its own. Run automatically before `next build`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, "..");
const repo = path.resolve(site, "..");
const docsSrc = path.join(repo, "docs");
const skillsSrc = path.join(repo, "skills");
const out = path.join(site, "content");
const assetsOut = path.join(site, "public", "docs-assets");

if (!fs.existsSync(docsSrc)) {
  if (fs.existsSync(path.join(out, "docs-index.json"))) {
    console.log("sync-content: repo docs not found, keeping existing content/");
    process.exit(0);
  }
  console.error("sync-content: ../docs not found and no prebuilt content/");
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(assetsOut, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "docs"), { recursive: true });

// ---------- docs ----------
const pages = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; // internal tooling folders (.generated, .i18n)
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(md|mdx)$/.test(entry.name)) pages.push(full);
  }
};
walk(docsSrc);

const toSlug = (file) => {
  let rel = path
    .relative(docsSrc, file)
    .split(path.sep)
    .join("/")
    .replace(/\.(md|mdx)$/, "");
  if (rel === "index") return "";
  if (rel.endsWith("/index")) rel = rel.slice(0, -"/index".length);
  return rel;
};

const SKIP = new Set(["AGENTS", "docs_map"]);
const index = [];
const seen = new Set();
for (const file of pages.sort()) {
  const slug = toSlug(file);
  const base = path.basename(file).replace(/\.(md|mdx)$/, "");
  if (SKIP.has(base) && !slug.includes("/")) continue;
  if (seen.has(slug)) continue; // foo.md beats foo/index.md
  seen.add(slug);
  const raw = fs.readFileSync(file, "utf8");
  let fm = {};
  let body = raw;
  try {
    const parsed = matter(raw);
    fm = parsed.data ?? {};
    body = parsed.content;
  } catch {
    body = raw.replace(/^---[\s\S]*?\n---\n/, "");
  }
  const h1 = body.match(/^#\s+(.+)$/m)?.[1];
  const title = String(
    fm.title ?? fm.sidebarTitle ?? h1 ?? (base === "index" ? "Docs" : base.replace(/[-_]/g, " ")),
  ).trim();
  const description = String(fm.summary ?? fm.description ?? "")
    .trim()
    .slice(0, 240);
  const headings = [...body.matchAll(/^#{2,3}\s+(.+)$/gm)]
    .map((m) => m[1].replace(/[`*_]/g, "").trim())
    .slice(0, 24);
  const target = path.join(out, "docs", `${slug || "index"}.md`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
  index.push({ slug, title, description, section: slug.split("/")[0] || "start", headings });
}

// navigation (English tabs only)
const docsJson = JSON.parse(fs.readFileSync(path.join(docsSrc, "docs.json"), "utf8"));
const en =
  (docsJson.navigation?.languages ?? []).find((l) => l.language === "en") ?? docsJson.navigation;
const titleOf = new Map(index.map((p) => [p.slug, p.title]));
const norm = (p) => (p === "index" ? "" : p.replace(/\/index$/, ""));
const navGroup = (g) => ({
  group: g.group,
  pages: (g.pages ?? [])
    .map((p) =>
      typeof p === "string"
        ? titleOf.has(norm(p))
          ? { slug: norm(p), title: titleOf.get(norm(p)) }
          : null
        : navGroup(p),
    )
    .filter(Boolean),
});
const nav = (en.tabs ?? []).map((t) => ({ tab: t.tab, groups: (t.groups ?? []).map(navGroup) }));

// redirects, validated so Next accepts them
const redirects = (docsJson.redirects ?? [])
  .filter(
    (r) =>
      typeof r.source === "string" && typeof r.destination === "string" && r.source.startsWith("/"),
  )
  .map((r) => ({
    source: `/docs${r.source === "/" ? "" : r.source}`,
    destination: /^https?:/.test(r.destination)
      ? r.destination
      : `/docs${r.destination === "/" ? "" : r.destination}`,
    permanent: true,
  }))
  .filter((r) => r.source !== r.destination && !/[()?+]/.test(r.source));

fs.writeFileSync(path.join(out, "docs-index.json"), JSON.stringify(index));
fs.writeFileSync(path.join(out, "docs-nav.json"), JSON.stringify(nav));
fs.writeFileSync(path.join(out, "docs-redirects.json"), JSON.stringify(redirects));

// every non-markdown file referenced from docs (images, diagrams, downloads)
const copyAssets = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) copyAssets(full);
    else if (!/\.(md|mdx|json)$/i.test(entry.name)) {
      const target = path.join(assetsOut, path.relative(docsSrc, full));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(full, target);
    }
  }
};
copyAssets(docsSrc);

// ---------- skills ----------
const SCAN = [
  [
    "pipe-to-shell",
    "high",
    /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b/,
    "Downloads and runs remote code",
  ],
  [
    "destructive-shell",
    "high",
    /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f|\bmkfs\b|\bdd\s+[^\n]*of=\/dev\//,
    "Destructive shell command",
  ],
  [
    "secret-read",
    "high",
    /(~\/\.ssh|id_rsa|\.aws\/credentials|security\s+find-generic-password)/,
    "Reads stored credentials",
  ],
  [
    "network-post",
    "medium",
    /\b(fetch|axios|requests)\b[^\n]*(POST|post\()|curl\b[^\n]*(-X\s*POST|--data)/,
    "Sends data to the network",
  ],
  ["sudo", "medium", /\bsudo\b/, "Asks for root"],
  ["eval", "medium", /\beval\s*\(|new\s+Function\s*\(|os\.system\(/, "Runs dynamic code"],
  [
    "env-secrets",
    "low",
    /\$\{?[A-Z_]{3,}_(KEY|TOKEN|SECRET)\b|process\.env|os\.environ/,
    "Reads secrets from the environment",
  ],
];
const skills = [];
if (fs.existsSync(skillsSrc)) {
  for (const name of fs.readdirSync(skillsSrc).sort()) {
    const file = path.join(skillsSrc, name, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    let text = "";
    const collect = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) collect(f);
        else if (e.isFile() && fs.statSync(f).size < 512_000)
          text += `\n${fs.readFileSync(f, "utf8")}`;
      }
    };
    collect(path.join(skillsSrc, name));
    let fm = {};
    try {
      fm = matter(fs.readFileSync(file, "utf8")).data ?? {};
    } catch {
      fm = {};
    }
    let meta = fm.metadata ?? {};
    if (typeof meta === "string") {
      try {
        meta = JSON.parse(meta);
      } catch {
        meta = {};
      }
    }
    const om = meta.omnipolymath ?? {};
    const requires = om.requires ?? {};
    const findings = SCAN.filter(([, , rx]) => rx.test(text)).map(([id, severity, , detail]) => ({
      id,
      severity,
      detail,
    }));
    const risk = findings.some((f) => f.severity === "high")
      ? "high"
      : findings.some((f) => f.severity === "medium")
        ? "medium"
        : "low";
    skills.push({
      name: String(fm.name ?? name),
      slug: name,
      description: String(fm.description ?? "").slice(0, 280),
      emoji: om.emoji ?? "◆",
      homepage: typeof fm.homepage === "string" ? fm.homepage : undefined,
      bins: Array.isArray(requires.bins) ? requires.bins : [],
      env: Array.isArray(requires.env) ? requires.env : [],
      os: Array.isArray(om.os) ? om.os : [],
      installers: Array.isArray(om.install) ? om.install.map((i) => i.kind).filter(Boolean) : [],
      findings,
      risk,
    });
  }
}
fs.writeFileSync(path.join(out, "skills.json"), JSON.stringify(skills));

console.log(
  `sync-content: ${index.length} docs pages, ${nav.length} tabs, ${redirects.length} redirects, ${skills.length} skills`,
);
