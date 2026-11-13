import { docsIndex } from "@/lib/content";

export const dynamic = "force-static";

export function GET() {
  const rows = docsIndex().map((d) => [d.slug, d.title, d.description.slice(0, 160), d.headings.slice(0, 12).join(" · ")]);
  return Response.json(rows, { headers: { "Cache-Control": "public, max-age=3600" } });
}
