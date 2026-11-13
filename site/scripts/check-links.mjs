#!/usr/bin/env node
// Crawl a running site and report broken internal links (and, with --external,
// external links found on non-docs pages).
//   node scripts/check-links.mjs http://localhost:3000 [--external]
const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const checkExternal = process.argv.includes("--external");
const seen = new Set();
const queue = [
  "/",
  "/onboarding",
  "/dashboard",
  "/skills",
  "/docs",
  "/privacy",
  "/install.sh",
  "/install-cli.sh",
  "/install.ps1",
  "/search-index.json",
];
const broken = [];
const external = new Map();
const CONCURRENCY = 16;

const hrefs = (html) =>
  [...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

async function visit(path, from) {
  const res = await fetch(base + path, { redirect: "manual" }).catch((e) => ({
    status: 0,
    error: e,
  }));
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (loc) {
      const u = new URL(loc, base + path);
      if (u.origin === new URL(base).origin) enqueue(u.pathname + u.search, path);
      else external.set(u.href, path);
    }
    return;
  }
  if (res.status !== 200) {
    broken.push({ path, status: res.status, from });
    return;
  }
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/html")) return;
  const html = await res.text();
  for (const raw of hrefs(html)) {
    if (/^(mailto:|tel:|data:|javascript:|#)/.test(raw)) continue;
    const u = new URL(raw, base + path);
    if (u.origin === new URL(base).origin) {
      if (u.pathname.startsWith("/_next/")) continue;
      enqueue(u.pathname, path);
    } else if (!path.startsWith("/docs")) {
      external.set(u.href.split("#")[0], path);
    }
  }
}

function enqueue(p, from) {
  const clean = decodeURI(p.split("#")[0]);
  if (!seen.has(clean)) {
    seen.add(clean);
    queue.push([clean, from]);
  }
}

// Seed every docs page so links on pages outside the navigation are checked too.
try {
  const idx = await (await fetch(`${base}/search-index.json`)).json();
  for (const [slug] of idx) queue.push(`/docs${slug ? `/${slug}` : ""}`);
} catch {
  console.warn("could not load search index; crawling from links only");
}
const work = [...new Set(queue.splice(0))].map((p) => [p, "(seed)"]);
for (const [p] of work) seen.add(p);
queue.push(...work);
async function run() {
  while (queue.length) {
    const batch = queue.splice(0, CONCURRENCY);
    await Promise.all(batch.map(([p, from]) => visit(p, from)));
  }
}
await run();

let extBroken = [];
if (checkExternal) {
  const urls = [...external.keys()];
  for (let i = 0; i < urls.length; i += 8) {
    await Promise.all(
      urls.slice(i, i + 8).map(async (u) => {
        let status = 0;
        try {
          const r = await fetch(u, {
            method: "GET",
            redirect: "follow",
            headers: { "user-agent": "Mozilla/5.0 (link check)" },
            signal: AbortSignal.timeout(15000),
          });
          status = r.status;
        } catch {
          status = 0;
        }
        // LinkedIn/Instagram/X block bots with 999/429/403; report them separately.
        if (status >= 400 || status === 0)
          extBroken.push({ url: u, status, from: external.get(u) });
      }),
    );
  }
}

console.log(`checked ${seen.size} internal URLs; ${broken.length} broken`);
for (const b of broken.slice(0, 200)) console.log(`  ${b.status}  ${b.path}  (from ${b.from})`);
if (checkExternal) {
  console.log(
    `checked ${external.size} external URLs on non-docs pages; ${extBroken.length} not OK`,
  );
  for (const b of extBroken) console.log(`  ${b.status}  ${b.url}  (from ${b.from})`);
}
process.exit(broken.length ? 1 : 0);
