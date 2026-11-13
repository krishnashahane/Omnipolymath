import { docsIndex } from "@/lib/content";

// Backs `omnipolymath docs <query>`: GET /docs/api/search?q=… → { results: [{ title, link, snippet }] }.
const SITE = "https://omnipolymath.vercel.app";
const MAX_RESULTS = 10;

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);

export function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 200) ?? "";
  const terms = words(q);
  if (terms.length === 0) {
    return Response.json({ results: [] });
  }
  const phrase = q.toLowerCase();
  const scored = docsIndex()
    .map((d) => {
      const title = d.title.toLowerCase();
      const desc = d.description.toLowerCase();
      const heads = d.headings.join(" ").toLowerCase();
      const slug = d.slug.toLowerCase();
      let score = 0;
      let matched = 0;
      for (const t of terms) {
        let hit = false;
        if (title.includes(t)) {
          score += 6;
          hit = true;
        }
        if (slug.includes(t)) {
          score += 3;
          hit = true;
        }
        if (heads.includes(t)) {
          score += 2;
          hit = true;
        }
        if (desc.includes(t)) {
          score += 1;
          hit = true;
        }
        if (hit) {
          matched += 1;
        }
      }
      if (title.includes(phrase)) {
        score += 8;
      }
      // Pages must match every term.
      return { d, score: matched === terms.length ? score : 0 };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.d.title.localeCompare(b.d.title))
    .slice(0, MAX_RESULTS);
  return Response.json(
    {
      results: scored.map(({ d }) => ({
        title: d.title,
        link: `${SITE}/docs${d.slug ? `/${d.slug}` : ""}`,
        snippet: d.description || undefined,
      })),
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
